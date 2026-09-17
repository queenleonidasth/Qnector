import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ExecutionStore, type AcceptTaskInput } from "./execution-store.js";
import { OutputSpool } from "./output-spool.js";

const roots: string[] = [];
function fixture(): { store: ExecutionStore; file: string; input: AcceptTaskInput } {
  const root = mkdtempSync(path.join(tmpdir(),"qnector-execution-"));
  roots.push(root);
  const file = path.join(root,"execution.sqlite");
  return {store:new ExecutionStore(file),file,input:{
    owner:"local-user",workspace:path.join(root,"workspace"),operation:"shell.run",
    idempotencyKey:"one",inputDigest:"sha256:one",definitionSnapshot:{command:"test"},
  }};
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });

describe("Durable execution acceptance and recovery (P1)",() => {
  it("commits task, event and dispatch together; retry after lost response finds same task across reopen",() => {
    const {store,file,input} = fixture();
    const first = store.accept(input);
    expect(first.reused).toBe(false);
    expect(store.pending()).toEqual([first.task.taskId]);
    expect(store.events(first.task.taskId).map(event => event.name)).toEqual(["accepted"]);
    store.close();
    const reopened = new ExecutionStore(file);
    const retry = reopened.accept(input);
    expect(retry.reused).toBe(true);
    expect(retry.task.taskId).toBe(first.task.taskId);
    expect(reopened.pending()).toEqual([first.task.taskId]);
    expect(reopened.list(input.workspace)).toHaveLength(1);
    reopened.close();
  });

  it("deduplicates 20 submissions and rejects same-key payload mutation",() => {
    const {store,input} = fixture();
    const responses = Array.from({length:20},() => store.accept(input));
    expect(new Set(responses.map(response => response.task.taskId)).size).toBe(1);
    expect(responses.filter(response => !response.reused)).toHaveLength(1);
    expect(store.pending()).toHaveLength(1);
    expect(() => store.accept({...input,inputDigest:"changed"})).toThrow("IDEMPOTENCY_CONFLICT");
    expect(store.list(input.workspace)).toHaveLength(1);
    expect(() => store.accept({...input,definitionSnapshot:{command:"different"}})).toThrow("IDEMPOTENCY_CONFLICT");
    store.close();
  });

  it("serializes two SQLite connections and preserves the same accepted handle",() => {
    const {store,file,input} = fixture();
    const other = new ExecutionStore(file);
    const a = store.accept(input);
    const b = other.accept(input);
    expect(b).toMatchObject({reused:true,task:{taskId:a.task.taskId}});
    const claim = other.claim(a.task.taskId);
    expect(claim).not.toBeNull();
    expect(store.claim(a.task.taskId)).toBeNull();
    other.close();
    store.close();
  });

  it("rejects completion without a valid manifest; does not falsify success",() => {
    const {store,input,file} = fixture();
    const task = store.accept(input).task;
    const attempt = store.claim(task.taskId)!;
    expect(store.markStarted(attempt)).toBe(true);
    expect(() => store.finish(attempt,{state:"succeeded",outputState:"complete",manifestPath:path.join(path.dirname(file),"missing.json")})).toThrow("OUTPUT_MANIFEST_INVALID");
    expect(store.get(task.taskId)?.state).toBe("running");
    const badManifest = new OutputSpool(path.dirname(file),attempt.attemptId).finalize(2,null).path;
    expect(() => store.finish(attempt,{state:"succeeded",outputState:"complete",manifestPath:badManifest})).toThrow("OUTPUT_MANIFEST_INVALID");
    expect(store.finish(attempt,{state:"failed",outputState:"complete",manifestPath:badManifest})).toBe(true);
    expect(store.get(task.taskId)?.state).toBe("failed");
    store.close();
  });
  it("scopes keys to owner, workspace and operation; never deduplicates command text alone",() => {
    const {store,input} = fixture();
    const a = store.accept(input).task.taskId;
    expect(store.accept({...input,idempotencyKey:"two"}).task.taskId).not.toBe(a);
    expect(store.accept({...input,owner:"another-owner"}).task.taskId).not.toBe(a);
    expect(store.accept({...input,operation:"search"}).task.taskId).not.toBe(a);
    expect(store.accept({...input,workspace:path.join(input.workspace,"subdir")}).task.taskId).not.toBe(a);
    store.close();
  });

  it("CAS-claims once, rejects forged worker tokens and commits completion manifest path",() => {
    const {store,input,file} = fixture();
    const task = store.accept(input).task;
    const attempt = store.claim(task.taskId)!;
    const manifestPath = new OutputSpool(path.dirname(file),attempt.attemptId).finalize(0,null).path;
    expect(store.claim(task.taskId)).toBeNull();
    expect(store.pending()).toEqual([]);
    expect(store.markStarted({...attempt,token:"forged"})).toBe(false);
    expect(store.markStarted(attempt)).toBe(true);
    expect(store.markStarted(attempt)).toBe(false);
    expect(store.finish({...attempt,token:"wrong"},{state:"succeeded",outputState:"complete",manifestPath})).toBe(false);
    expect(store.finish(attempt,{state:"succeeded",outputState:"complete",manifestPath})).toBe(true);
    expect(store.finish(attempt,{state:"succeeded",outputState:"complete",manifestPath})).toBe(false);
    expect(store.get(task.taskId)).toMatchObject({state:"succeeded",outcome:"known",resultManifest:manifestPath});
    expect(store.events(task.taskId).map(event => event.name)).toEqual(["accepted","claimed","started","succeeded"]);
    store.close();
  });

  it("reconciles unknown startup outcome without blind dispatch; finished work is never replayed",() => {
    const {store,file,input} = fixture();
    const task = store.accept(input).task;
    const attempt = store.claim(task.taskId)!;
    store.close(); // simulate daemon crash between dispatch claim and worker acknowledgment
    const recovered = new ExecutionStore(file);
    expect(recovered.pending()).toEqual([]);
    expect(recovered.get(task.taskId)?.state).toBe("starting");
    expect(recovered.interruptUnverified(task.taskId,"worker identity cannot be verified")).toBe(true);
    expect(recovered.get(task.taskId)).toMatchObject({state:"interrupted",outcome:"unknown"});
    expect(recovered.claim(task.taskId)).toBeNull();
    expect(recovered.markStarted(attempt)).toBe(false);
    expect(recovered.interruptUnverified(task.taskId,"again")).toBe(false);
    recovered.close();
  });

  it("distinguishes queued cancellation from running cancel requests requiring confirmation",() => {
    const {store,input,file} = fixture();
    const queued = store.accept(input).task;
    expect(store.requestCancel(queued.taskId)).toBe("canceled");
    expect(store.pending()).toEqual([]);
    expect(store.claim(queued.taskId)).toBeNull();
    const running = store.accept({...input,idempotencyKey:"run"}).task;
    const attempt = store.claim(running.taskId)!;
    expect(store.markStarted(attempt)).toBe(true);
    expect(store.requestCancel(running.taskId)).toBe("canceling");
    expect(store.get(running.taskId)?.state).toBe("canceling");
    const manifestPath = new OutputSpool(path.dirname(file), attempt.attemptId)
      .finalize(null, "SIGTERM", true).path;
    expect(store.confirmCanceled({...attempt,token:"wrong"}, manifestPath)).toBe(false);
    expect(store.confirmCanceled(attempt, manifestPath)).toBe(true);
    expect(store.get(running.taskId)?.resultManifest).toBe(manifestPath);
    expect(store.get(running.taskId)).toMatchObject({state:"canceled",outputState:"partial"});
    store.close();
  });
});
