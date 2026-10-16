import { describe, expect, it } from "vitest";
import { assessAcceptance, classifyGate } from "./acceptance-scope.mjs";

const gates = [
  {gate:"typecheck",status:"PASS",evidence:"tsc"},
  {gate:"electron-gui",status:"PASS",evidence:"packaged test"},
  {gate:"tunnel",status:"UNKNOWN",evidence:"not connected"},
  {gate:"chatgpt-host",status:"UNKNOWN",evidence:"not connected"},
  {gate:"controlled-performance-suite",status:"UNKNOWN",evidence:"incomplete cold samples"},
] as const;
describe("local-only acceptance scope",()=>{
  it("defaults to strict release: unknown blocks publication",()=>{
    const assessed=assessAcceptance(gates);
    expect(assessed.releaseEligible).toBe(false);
    expect(assessed.localValidationEligible).toBe(false);
    expect(assessed.gates.map(x=>x.status)).toEqual(["PASS","PASS","UNKNOWN","UNKNOWN","UNKNOWN"]);
  });
  it("waives only explicitly external simultaneous-app gates, never calls them PASS",()=>{
    const assessed=assessAcceptance(gates,{skipConcurrentApps:true});
    expect(assessed.gates.map(x=>x.status)).toEqual(["PASS","PASS","SKIPPED","SKIPPED","UNKNOWN"]);
    expect(assessed.releaseEligible).toBe(false);
    expect(assessed.localValidationEligible).toBe(false);
    expect(assessed.waivedGates).toEqual(["tunnel","chatgpt-host"]);
    expect(classifyGate("controlled-performance-suite",{skipConcurrentApps:true})).toBe("REQUIRED");
  });
  it("reports passing local tests separately from public release, never skips failure",()=>{
    const localReady=assessAcceptance(gates.slice(0,4),{skipConcurrentApps:true});
    expect(localReady.localValidationEligible).toBe(true);
    expect(localReady.releaseEligible).toBe(false);
    const bad=assessAcceptance([{gate:"tunnel",status:"FAIL",evidence:"real failure"}],{skipConcurrentApps:true});
    expect(bad.gates[0].status).toBe("FAIL");
    expect(bad.localValidationEligible).toBe(false);
  });
  it("refuses any waiver when a gate represents product-native correctness",()=>{
    for(const gate of ["test","typecheck","native-build","stdio-packaged","electron-gui","controlled-performance-suite"]){
      expect(classifyGate(gate,{skipConcurrentApps:true})).toBe("REQUIRED");
    }
  });
});
