import {expect,test} from "bun:test";
import {namedControlFailed} from "./fixtures/source-control-evidence.ts";

test("control evidence requires the named failing test",()=>{
  expect(namedControlFailed("(fail) owner > required boundary [1ms]", "required boundary")).toBe(true);
  expect(namedControlFailed("\x1b[31m(fail)\x1b[0m required boundary", "required boundary")).toBe(true);
});
test("a passing oracle and an unrelated failure are not a caught control",()=>{
  expect(namedControlFailed("(pass) required boundary\n(fail) unrelated", "required boundary")).toBe(false);
});
test("an expected name in source or stack text is not a failing-test identity",()=>{
  expect(namedControlFailed('source: test("required boundary")\n(fail) unrelated', "required boundary")).toBe(false);
  expect(namedControlFailed('123 | throw Error("(fail) required boundary")\n(fail) unrelated', "required boundary")).toBe(false);
});
test("setup errors and fixture timeouts never count as a caught control",()=>{
  for(const setup of ["Cannot find module", "Cannot find package", "SyntaxError", "ParseError", "Test timed out", "timed out after 1000ms"])
    expect(namedControlFailed(`${setup}\n(fail) required boundary`, "required boundary")).toBe(false);
  expect(namedControlFailed("(fail) required boundary", "")).toBe(false);
});
