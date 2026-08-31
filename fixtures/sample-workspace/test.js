import test from "node:test";
import assert from "node:assert/strict";
import { greeting } from "./src/index.js";

test("greeting", () => assert.equal(greeting("Qnector"), "Hello, Qnector"));
