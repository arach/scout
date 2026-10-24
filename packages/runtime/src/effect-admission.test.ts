import {test,expect} from "bun:test";
import {admitSynchronousEffect} from "./effect-admission.ts";
test("effect admission permits an absent hook and calls a synchronous hook anew",()=>{
 expect(admitSynchronousEffect()).toBeUndefined();let calls=0;
 const hook=()=>{calls++;};admitSynchronousEffect(hook);admitSynchronousEffect(hook);expect(calls).toBe(2);
});
test("effect admission propagates the exact refusal, including I/O-shaped errors",()=>{
 const refusal=Object.assign(new Error("revoked"),{code:"ENOENT"});
 let caught: unknown;try{admitSynchronousEffect(()=>{throw refusal;});}catch(error){caught=error;}expect(caught).toBe(refusal);
});
test.each([async()=>{},()=>Promise.resolve(),()=>({then(){}}) as never])("effect admission refuses asynchronous authority %#",hook=>{
 expect(()=>admitSynchronousEffect(hook)).toThrow("synchronous effect admission required");
});
