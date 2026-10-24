import {expect,test} from "bun:test";
import {namedControlFailed,assertionControlFailed} from "./fixtures/source-control-evidence.ts";

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

const statement='assert.equal(late,0,"no resumed effect");';
const actual=`89 |   ${statement}\n              ^\nAssertionError: no resumed effect\n`;
test("assertion evidence identifies the highlighted assertion and error",()=>{
 expect(assertionControlFailed(actual,statement,"no resumed effect")).toBe(true);
 expect(assertionControlFailed("\x1b[31m"+actual+"\x1b[0m",statement,"no resumed effect")).toBe(true);
});
test("printed assertion or another failure cannot qualify the worker oracle",()=>{
 for(const text of [statement+"\nAssertionError: unrelated",actual.replace("AssertionError: no resumed effect","AssertionError: unrelated"),actual.replace(statement,"assert.equal(other,0);"),`source: ${statement}\n(fail) unrelated`])
  expect(assertionControlFailed(text,statement,"no resumed effect")).toBe(false);
});
test("assertion evidence rejects setup failures, timeouts and empty identities",()=>{
 for(const error of ["Cannot find module","SyntaxError","timed out after 60000ms","pause not reached","settled before pause"])
  expect(assertionControlFailed(error+"\n"+actual,statement,"no resumed effect")).toBe(false);
 expect(assertionControlFailed(actual,"","no resumed effect")).toBe(false);
 expect(assertionControlFailed(actual,statement,"")).toBe(false);
});
