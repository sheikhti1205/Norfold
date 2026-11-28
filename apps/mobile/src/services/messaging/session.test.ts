// @vitest-environment node
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it } from "vitest";
import { openWebMessagingHistory } from "./indexedDbHistory";
import type { HumanMessage, MailboxEnvelope, MessagingHistory } from "./history";
import { createMessagingSession, type MessagingRpc } from "./session";
import { emptyConversationHead, emptyConversationRange } from "./headTestDoubles";

const A="00000000-0000-4000-8000-000000000001";
const B="00000000-0000-4000-8000-000000000002";
const DEVICE="00000000-0000-4000-8000-000000000003";
const ID="00000000-0000-4000-8000-000000000004";
const CONV="00000000-0000-4000-8000-000000000005";
const MAIL="00000000-0000-4000-8000-000000000006";
const mailbox=(n:number)=>`00000000-0000-4000-8000-${(500+n).toString(16).padStart(12,"0")}`;
const scope={accountId:A,deviceId:DEVICE};
const message:HumanMessage={id:ID,conversationId:CONV,authorId:A,recipientId:B,body:"I found your bag."};
const handles:MessagingHistory[]=[];
afterEach(()=>{ for(const h of handles.splice(0)) h.close(); });
function serverFor(history: MessagingHistory) {
 let envelope:MailboxEnvelope|null=null;
 let sendFailure:string|null=null; let currentAccount=A; let acknowledged=false;
 const rpc:MessagingRpc=async(input)=>{
  if(input.accountId!==currentAccount) throw new Error("Session changed");
  if(input.action==="HEAD") return emptyConversationHead(A,input.args.conversationId as string);
  if(input.action==="CONVERSATION_SYNC") return emptyConversationRange(input.args.head);
  if(input.action==="SEND" && sendFailure) throw new Error(sendFailure);
  if(input.action==="SEND") {
   envelope={...scope,mailboxId:MAIL,event:{kind:"TEXT",eventId:ID,sequence:1,message}};
   return ID;
  }
  if(input.action==="SYNC") return envelope?[envelope]:[];
  // No server-side state changes in this fixture; the session still syncs first.
  if(input.action==="STATE_SYNC") return [];
  if(input.action==="ACK") {
   // A fake server is allowed to discard only after real local storage is readable.
   expect((await history.getMessage(ID))?.server?.eventId).toBe(ID);
   acknowledged=true; envelope=null; return null;
  }
  if(input.action==="CREATE") return CONV;
  return null;
 };
 return {rpc,failSend:(message:string)=>{sendFailure=message;}, switchAccount:()=>{currentAccount=B;},
  acked:()=>acknowledged, replaceEnvelope:(value:MailboxEnvelope)=>{envelope=value;}};
}
async function setup() {
 const factory=new IDBFactory();
 const history=await openWebMessagingHistory(scope,{indexedDB:factory}); handles.push(history);
 const server=serverFor(history);
 return {history,factory,...server,session:createMessagingSession(scope,history,server.rpc)};
}

describe("human messaging session delivery",()=>{
 it("queues durably, sends, persists its authoritative echo, then ACKs",async()=>{
  const f=await setup(); await f.session.start("web");
  expect(await f.session.request(B)).toBe(CONV);
  await f.session.send(message);
  expect(await f.history.listOutbox()).toHaveLength(1);
  await f.session.flush();
  expect(f.acked()).toBe(true);
  expect(await f.history.listOutbox()).toEqual([]);
  expect((await f.history.getMessage(ID))?.body).toBe(message.body);
 });
 it("retains failed sends across reopen and retries the same message identity",async()=>{
  const f=await setup(); await f.session.send(message); f.failSend("Offline");
  await expect(f.session.flush()).rejects.toThrow("Offline");
  expect((await f.history.listOutbox())[0]?.status).toBe("FAILED");
  f.session.close();
  const reopened=await openWebMessagingHistory(scope,{indexedDB:f.factory}); handles.push(reopened);
  expect((await reopened.listOutbox())[0]?.messageId).toBe(ID);
  // The durable identity survives and a later session sends the same message.
  const server=serverFor(reopened);
  const retry=createMessagingSession(scope,reopened,server.rpc);
  await retry.flush();
  expect(server.acked()).toBe(true);
  expect(await reopened.listOutbox()).toEqual([]);
 });
 it("never ACKs a storage failure",async()=>{
  const f=await setup();
  let writable=false;
  const broken:MessagingHistory={...f.history,persistInboundAndAck:async(...args)=>{
   if(!writable) throw new Error("disk full");
   return f.history.persistInboundAndAck(...args);
  }};
  const session=createMessagingSession(scope,broken,f.rpc);
  await session.send(message);
  await expect(session.flush()).rejects.toThrow("disk full");
  expect(f.acked()).toBe(false);
  writable=true;
  // Retry must fetch the committed server echo despite the still-active lease.
  await session.flush();
  expect(f.acked()).toBe(true); expect(await f.history.listOutbox()).toEqual([]);
 });
 it("rejects a foreign-account envelope before persisting or ACKing",async()=>{
  const f=await setup();
  f.replaceEnvelope({...scope,accountId:B,mailboxId:MAIL,event:{kind:"TEXT",eventId:ID,sequence:1,message}});
  await expect(f.session.sync()).rejects.toThrow();
  expect(await f.history.getMessage(ID)).toBeNull(); expect(f.acked()).toBe(false);
 });
 it("rejects outgoing content attributed to another account",async()=>{
  const f=await setup();
  await expect(f.session.send({...message,authorId:B,recipientId:A})).rejects.toThrow();
  expect(await f.history.listOutbox()).toEqual([]);
 });
 it("the captured server account guard refuses a switched SDK session",async()=>{
  const f=await setup(); await f.session.send(message); f.switchAccount();
  await expect(f.session.flush()).rejects.toThrow("Session changed");
  // The pre-send state sync fails under the switched account, so no send was
  // attempted: the entry must stay retryable rather than be marked failed.
  expect((await f.history.listOutbox())[0]?.status).toBe("QUEUED"); expect(f.acked()).toBe(false);
 });
 it("closed sessions cannot dispatch or ACK",async()=>{
  const f=await setup(); f.session.close();
  await expect(f.session.sync()).rejects.toThrow(/closed/i);
  await expect(f.session.request(B)).rejects.toThrow(/closed/i);
  expect(f.acked()).toBe(false);
 });
 it("carries the reply reference on SEND and keeps it through the echo",async()=>{
  const factory=new IDBFactory();
  const history=await openWebMessagingHistory(scope,{indexedDB:factory}); handles.push(history);
  const REPLY="00000000-0000-4000-8000-00000000000a";
  const calls:Array<Record<string,unknown>>=[];
  const envelopes=new Map<string,MailboxEnvelope>();
  const rpc:MessagingRpc=async(input)=>{
   if(input.action==="HEAD") return emptyConversationHead(A,input.args.conversationId as string);
   if(input.action==="CONVERSATION_SYNC") return emptyConversationRange(input.args.head);
   if(input.action==="SEND"){
    calls.push(input.args);
    const args=input.args as {messageId:string;body:string;replyToId?:string};
    envelopes.set(args.messageId,{...scope,mailboxId:MAIL,event:{kind:"TEXT",eventId:args.messageId,sequence:1,
     message:{id:args.messageId,conversationId:CONV,authorId:A,recipientId:B,body:args.body,
      ...(args.replyToId?{replyToId:args.replyToId}:{})}}});
    return args.messageId;
   }
   if(input.action==="SYNC") return [...envelopes.values()];
   if(input.action==="STATE_SYNC") return [];
   if(input.action==="ACK") return null;
   return null;
  };
  const session=createMessagingSession(scope,history,rpc);
  await session.send({...message,replyToId:REPLY});
  await session.flush();
  expect(calls).toEqual([expect.objectContaining({messageId:ID,replyToId:REPLY})]);
  expect((await history.getMessage(ID))?.replyToId).toBe(REPLY);
 });
 it("does not starve the queue behind a refused boundary and recovers it only on explicit retry",async()=>{
  const EPOCH_A="a".repeat(64), EPOCH_B="b".repeat(64);
  const SECOND="00000000-0000-4000-8000-000000000009";
  const factory=new IDBFactory();
  const history=await openWebMessagingHistory(scope,{indexedDB:factory}); handles.push(history);
  const boundary=(epoch:string,revision:number)=>({conversationId:CONV,peerId:B,mode:"CONNECTED" as const,
   request:"NONE" as const,requestEpoch:null,ownBlocked:false,ownDeclined:false,ownHidden:false,revision,epoch});
  await history.cacheConversation(boundary(EPOCH_A,1));
  const envelopes=new Map<string,MailboxEnvelope>(); let sequence=0;
  const rpc:MessagingRpc=async(input)=>{
  if(input.action==="HEAD") return emptyConversationHead(A,input.args.conversationId as string);
  if(input.action==="CONVERSATION_SYNC") return emptyConversationRange(input.args.head);
     if(input.action==="SEND"){
    const args=input.args as {messageId:string;expectedEpoch?:string;body:string};
    // The server refuses intent composed at a boundary that has since moved.
    if(args.expectedEpoch!==EPOCH_B) throw new Error("Relationship boundary moved");
    sequence+=1;
    envelopes.set(args.messageId,{...scope,mailboxId:MAIL,event:{kind:"TEXT",eventId:args.messageId,
     sequence,message:{id:args.messageId,conversationId:CONV,authorId:A,recipientId:B,body:args.body}}});
    return args.messageId;
   }
   if(input.action==="SYNC") return [...envelopes.values()];
   if(input.action==="STATE_SYNC") return [];
   if(input.action==="ACK") return null;
   return null;
  };
  const session=createMessagingSession(scope,history,rpc);
  await session.send(message);
  await session.send({...message,id:SECOND,body:"Second"});
  // One pass must attempt both rows: the refused one may not monopolise the queue.
  await expect(session.flush()).rejects.toThrow("Relationship boundary moved");
  expect(await history.listOutbox()).toEqual([
   {messageId:ID,status:"FAILED",attempts:1,expectedEpoch:EPOCH_A},
   {messageId:SECOND,status:"FAILED",attempts:1,expectedEpoch:EPOCH_A},
  ]);
  // The sync that delivered the new boundary does not, by itself, resend anything.
  await history.cacheConversation(boundary(EPOCH_B,2));
  await expect(session.flush()).rejects.toThrow("Relationship boundary moved");
  expect((await history.listOutbox()).find((row)=>row.messageId===ID)?.expectedEpoch).toBe(EPOCH_A);
  // Only the human retry re-binds the queued intent to the boundary they see now.
  await session.retryOutgoing(ID);
  expect((await history.listOutbox()).find((row)=>row.messageId===ID)?.expectedEpoch).toBe(EPOCH_B);
  // The re-bound row delivers; the still-stale one keeps its own boundary.
  await expect(session.flush()).rejects.toThrow("Relationship boundary moved");
  expect((await history.getMessage(ID))?.server).toMatchObject({eventId:ID});
  expect(await history.listOutbox()).toEqual([
   {messageId:SECOND,status:"FAILED",attempts:3,expectedEpoch:EPOCH_A},
  ]);
 });
 it("settles one state read for one send instead of repeating it at every step",async()=>{
  const factory=new IDBFactory();
  const history=await openWebMessagingHistory(scope,{indexedDB:factory}); handles.push(history);
  const actions:string[]=[];
  const OTHER="00000000-0000-4000-8000-00000000001f";
  let statePages=1;
  let envelope:MailboxEnvelope|null=null;
  const rpc:MessagingRpc=async(input)=>{
   actions.push(input.action);
   // One authorized state event creates the durable cursor every later read
   // would re-ACK; it targets another conversation so it cannot touch this send.
   if(input.action==="STATE_SYNC") return statePages-->0?[{...scope,change:{kind:"CLEAR_FOR_ME",
     eventId:"00000000-0000-4000-8000-00000000000d",sequence:1,conversationId:OTHER,peerId:B,throughSequence:1,
     occurredAt:1}}]:[];
   if(input.action==="HEAD") return emptyConversationHead(A,input.args.conversationId as string);
   if(input.action==="CONVERSATION_SYNC") return emptyConversationRange(input.args.head);
   if(input.action==="SEND") {
    envelope={...scope,mailboxId:MAIL,event:{kind:"TEXT",eventId:ID,sequence:1,message}};
    return ID;
   }
   if(input.action==="SYNC") return envelope?[envelope]:[];
   if(input.action==="ACK") { envelope=null; return null; }
   return null;
  };
  const session=createMessagingSession(scope,history,rpc);
  await session.syncState();
  expect(await history.getStateCursor()).toMatchObject({sequence:1});
  await session.send(message);
  actions.length=0;
  await session.flush();
  // The ACK the pass owed for its own applied state, then one state page, one
  // HEAD, the SEND and the echo page. Four state reads would re-ACK the same
  // cursor and re-fetch the same unchanged page for each of those steps.
  expect(actions.slice(0,3)).toEqual(["STATE_ACK","STATE_SYNC","HEAD"]);
  expect(actions.filter(action=>action==="STATE_ACK")).toHaveLength(1);
  expect(actions.filter(action=>action==="STATE_SYNC")).toHaveLength(1);
  expect(actions.filter(action=>action==="HEAD")).toHaveLength(1);
  expect(actions.filter(action=>action==="SEND")).toHaveLength(1);
  expect(actions.filter(action=>action==="SYNC")).toHaveLength(1);
  expect(actions.indexOf("SEND")).toBeGreaterThan(actions.indexOf("HEAD"));
  expect(actions.indexOf("SYNC")).toBeGreaterThan(actions.indexOf("SEND"));
  expect(await history.listOutbox()).toEqual([]);
 });
 it("keeps a send durable while offline and delivers it on the next flush",async()=>{
  const factory=new IDBFactory();
  const history=await openWebMessagingHistory(scope,{indexedDB:factory}); handles.push(history);
  let online=true;
  let envelope:MailboxEnvelope|null=null;
  const rpc:MessagingRpc=async(input)=>{
   if(!online) throw new Error("Offline");
   if(input.action==="HEAD") return emptyConversationHead(A,input.args.conversationId as string);
   if(input.action==="CONVERSATION_SYNC") return emptyConversationRange(input.args.head);
   if(input.action==="SEND") {
    envelope={...scope,mailboxId:MAIL,event:{kind:"TEXT",eventId:ID,sequence:1,message}};
    return ID;
   }
   if(input.action==="SYNC") return envelope?[envelope]:[];
   if(input.action==="STATE_SYNC") return [];
   if(input.action==="ACK") { envelope=null; return null; }
   return null;
  };
  const session=createMessagingSession(scope,history,rpc);
  await session.send(message);
  online=false;
  await expect(session.flush()).rejects.toThrow("Offline");
  // No attempt was admitted, so the row is still exactly the captured intent.
  expect(await history.listOutbox()).toEqual([expect.objectContaining({messageId:ID,status:"QUEUED"})]);
  expect((await history.getMessage(ID))?.server).toBeUndefined();
  online=true;
  await session.flush();
  expect(await history.listOutbox()).toEqual([]);
  expect((await history.getMessage(ID))?.server).toMatchObject({eventId:ID});
 });
 it("sends with the head this device applied and repairs one stale-head refusal",async()=>{
  const factory=new IDBFactory();
  const history=await openWebMessagingHistory(scope,{indexedDB:factory}); handles.push(history);
  const actions:string[]=[]; const heads:number[]=[];
  let position=0;
  // The one head the gateway discloses, in the shape findback_chat_head_internal
  // publishes. Advancing a position is a message arriving after our checkpoint.
  const liveHead=()=>({accountId:A,conversationId:CONV,streamId:"fixture-stream",epoch:"fixture-epoch",
   revision:1+position,position,messageHead:position,stateHead:0,serverTime:1_000});
  const identity=(head:Record<string,unknown>)=>JSON.stringify({...head,serverTime:0});
  const rpc:MessagingRpc=async(input)=>{
   actions.push(input.action);
   if(input.action==="HEAD") return liveHead();
   if(input.action==="CONVERSATION_SYNC") return emptyConversationRange(input.args.head);
   if(input.action==="STATE_SYNC") return [];
   if(input.action==="SYNC") return [];
   if(input.action==="SEND"){
    const args=input.args as {messageId:string;expectedHead:Record<string,unknown>};
    heads.push((args.expectedHead as {position:number}).position);
    // The gateway refuses a head that no longer matches the live one, ignoring
    // only the server instant.
    if(identity(args.expectedHead)!==identity(liveHead())) throw new Error("Chat could not sync. Try again.");
    return args.messageId;
   }
   return null;
  };
  const session=createMessagingSession(scope,history,rpc);
  // A reconcile applies and commits the head this device then holds.
  await session.reconcileConversation(CONV);
  expect(await history.getConversationCheckpoint(CONV)).toMatchObject({position:0,revision:1});
  // A message arrives after that checkpoint: the cached head is now stale.
  position=1;
  await session.send(message);
  actions.length=0;
  await session.sendNow(CONV,ID);
  // One SEND from the cached head, one HEAD that proves the head moved, one retry.
  // No state read is on that path.
  expect(actions).toEqual(["SEND","HEAD","SEND"]);
  expect(heads).toEqual([0,1]);
  expect((await history.listOutbox())[0]).toMatchObject({messageId:ID,status:"SENDING"});
 });
 it("keeps one attempt and the ordinary failure path when the refusal is not a stale head",async()=>{
  const factory=new IDBFactory();
  const history=await openWebMessagingHistory(scope,{indexedDB:factory}); handles.push(history);
  const actions:string[]=[]; let refuse=true; const envelopes=new Map<string,MailboxEnvelope>();
  const rpc:MessagingRpc=async(input)=>{
   actions.push(input.action);
   if(input.action==="HEAD") return emptyConversationHead(A,input.args.conversationId as string);
   if(input.action==="CONVERSATION_SYNC") return emptyConversationRange(input.args.head);
   if(input.action==="STATE_SYNC") return [];
   if(input.action==="SEND"){
    if(refuse) throw new Error("Chat could not sync. Try again.");
    const args=input.args as {messageId:string;body:string};
    envelopes.set(args.messageId,{...scope,mailboxId:mailbox(1),event:{kind:"TEXT",eventId:args.messageId,sequence:1,
     message:{id:args.messageId,conversationId:CONV,authorId:A,recipientId:B,body:args.body}}});
    return args.messageId;
   }
   if(input.action==="SYNC") return [...envelopes.values()];
   if(input.action==="ACK"){ envelopes.clear(); return null; }
   return null;
  };
  const session=createMessagingSession(scope,history,rpc);
  await session.reconcileConversation(CONV);
  await session.send(message);
  actions.length=0;
  await expect(session.sendNow(CONV,ID)).rejects.toThrow("Chat could not sync. Try again.");
  // The head this device holds is still the live one, so this was not staleness:
  // the lane does not resend, and the row takes the ordinary failure path.
  expect(actions).toEqual(["SEND","HEAD"]);
  expect((await history.listOutbox())[0]).toMatchObject({messageId:ID,status:"FAILED",attempts:1});
  // The durable outbox is still the retry record: the background pass drains it.
  refuse=false;
  await session.flush();
  expect(await history.listOutbox()).toEqual([]);
  expect((await history.getMessage(ID))?.server).toMatchObject({eventId:ID});
 });
 it("claims only the submitted row and leaves the rest of the queue to the pass",async()=>{
  const SECOND="00000000-0000-4000-8000-00000000000c";
  const factory=new IDBFactory();
  const history=await openWebMessagingHistory(scope,{indexedDB:factory}); handles.push(history);
  const envelopes=new Map<string,MailboxEnvelope>(); let sequence=0;
  const rpc:MessagingRpc=async(input)=>{
   if(input.action==="HEAD") return emptyConversationHead(A,input.args.conversationId as string);
   if(input.action==="CONVERSATION_SYNC") return emptyConversationRange(input.args.head);
   if(input.action==="STATE_SYNC") return [];
   if(input.action==="SEND"){
    const args=input.args as {messageId:string;body:string};
    sequence+=1;
    envelopes.set(args.messageId,{...scope,mailboxId:mailbox(sequence),event:{kind:"TEXT",eventId:args.messageId,
     sequence,message:{id:args.messageId,conversationId:CONV,authorId:A,recipientId:B,body:args.body}}});
    return args.messageId;
   }
   if(input.action==="SYNC") return [...envelopes.values()];
   if(input.action==="ACK"){
    for(const [id,envelope] of envelopes) if(envelope.mailboxId===input.args.mailboxId){ envelopes.delete(id); break; }
    return null;
   }
   return null;
  };
  const session=createMessagingSession(scope,history,rpc);
  await session.send(message);
  await session.send({...message,id:SECOND,body:"Second"});
  await session.sendNow(CONV,SECOND);
  const rows=async()=>new Map((await history.listOutbox())
   .map((row)=>[row.messageId,{status:row.status,attempts:row.attempts}] as const));
  // The submitted row is the one claimable row for this lane; the older row keeps
  // its place in the queue instead of being leased and abandoned.
  expect(await rows()).toEqual(new Map([[ID,{status:"QUEUED",attempts:0}],
   [SECOND,{status:"SENDING",attempts:1}]]));
  // One background pass then drains both, settling the lease the lane left.
  await session.flush();
  expect(await rows()).toEqual(new Map());
  expect((await history.getMessage(ID))?.server).toMatchObject({eventId:ID});
  expect((await history.getMessage(SECOND))?.server).toMatchObject({eventId:SECOND});
 });
});
