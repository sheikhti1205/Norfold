// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { afterEach, expect, it } from "vitest";
import { openWebMessagingHistory } from "./indexedDbHistory";
import { createMessagingSession, type MessagingRpc } from "./session";
import { copyConversationProjection } from "./conversationIndex";
import type { MessagingHistory } from "./history";
const id=(n:number)=>`00000000-0000-4000-9700-${String(n).padStart(12,"0")}`;
const scope={accountId:id(1),deviceId:id(11)},peer=id(2),conversation=id(20);
const projection={conversationId:conversation,peerId:peer,mode:"CONNECTED" as const,request:"NONE" as const,requestEpoch:null,ownBlocked:false,ownHidden:false,ownDeclined:false,revision:1};
const handles:MessagingHistory[]=[];
afterEach(()=>{for(const handle of handles.splice(0))handle.close();});
async function setup(rpc:MessagingRpc){const history=await openWebMessagingHistory(scope,{indexedDB:new IDBFactory()});handles.push(history);return {history,session:createMessagingSession(scope,history,rpc)};}
it("validates the shared pin list: at most three unique message ids",async()=>{
 const first=id(40),second=id(41),third=id(42),fourth=id(43);
 const copy=copyConversationProjection({...projection,pinnedMessageIds:[first,second,third]});
 expect(copy.pinnedMessageIds).toEqual([first,second,third]);
 expect(copyConversationProjection(projection)).toEqual(projection);
 expect(()=>copyConversationProjection({...projection,pinnedMessageIds:[first,first]} as never)).toThrow();
 expect(()=>copyConversationProjection({...projection,pinnedMessageIds:[first,second,third,fourth]} as never)).toThrow();
 expect(()=>copyConversationProjection({...projection,pinnedMessageIds:["not-a-message"]} as never)).toThrow();
});
it("sends an explicit pin intent and rejects a response that disagrees",async()=>{
 const target=id(40),calls:Array<{action:string;args:unknown}>=[];let response:string[]=[target];
 const f=await setup(async input=>{expect(input.accountId).toBe(scope.accountId);expect(input.deviceId).toBe(scope.deviceId);calls.push({action:input.action,args:input.args});return response;});
 await f.session.setPinned(conversation,target,true);
 expect(calls).toEqual([{action:"PIN",args:{conversationId:conversation,messageId:target,pinned:true}}]);
 response=[];
 await expect(f.session.setPinned(conversation,target,true)).rejects.toThrow(/response/i);
 response=[target,target];
 await expect(f.session.setPinned(conversation,target,false)).rejects.toThrow(/response/i);
 await expect(f.session.setPinned(conversation,target,"true" as never)).rejects.toThrow();
});
it("aborts pin changes and refuses late completion after the captured account session closes",async()=>{
 let finish:(value:unknown)=>void=()=>{};let signal:AbortSignal|undefined;let entered!:()=>void;
 const started=new Promise<void>(resolve=>{entered=resolve;});
 const f=await setup(input=>{signal=input.signal;entered();return new Promise(resolve=>{finish=resolve;});});
 const work=f.session.setPinned(conversation,id(40),true);
 await started;
 f.session.close();expect(signal?.aborted).toBe(true);finish([id(40)]);
 await expect(work).rejects.toThrow(/closed/i);
 await expect(f.session.setPinned(conversation,id(40),false)).rejects.toThrow(/closed/i);
});
