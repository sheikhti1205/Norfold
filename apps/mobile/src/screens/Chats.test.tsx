// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { MessagingRuntimeSnapshot } from "../services/messaging/runtime";
const state = vi.hoisted(() => ({ chat: null as unknown as MessagingRuntimeSnapshot }));
vi.mock("../auth", () => ({ useAuth: () => ({ user: { id: "viewer" } }) }));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => state.chat }));
vi.mock("../services/accountLabels", () => ({ readCachedAccountIdentities: () => new Map(), fetchAccountIdentities: async () => new Map([
  ["peer", { id: "peer", username: "river", displayName: "River Jones" }],
  ["requester", { id: "requester", username: "robin", displayName: "Robin Lane" }],
  ["archived", { id: "archived", username: "rowan", displayName: "Rowan Lee" }],
]) }));
vi.mock("../services/people", async original => ({ ...await original<typeof import("../services/people")>(), searchPeople: async () => ({ items: [], nextCursor: null }) }));
vi.mock("../services/posts", () => ({ fetchPost: async () => ({ id:"report", title:"Blue wallet", type:"FOUND" }) }));
import { Connections, LegacyChatsRedirect, photoBatches, replyPreview, replySwipeFor } from "./Messaging";
import type { StoredHumanMessage } from "../services/messaging/history";
import { RouteTransition } from "../components/RouteTransition";
function Location() { return <p data-testid="location">{useLocation().pathname}</p>; }
function app() { return <MemoryRouter initialEntries={["/chats"]}><Routes><Route element={<RouteTransition />}>
  <Route path="/chats" element={<Connections />}><Route path=":conversationId" element={<><Location/><a href="#unused">Thread body</a></>} /></Route>
</Route></Routes></MemoryRouter>; }
beforeEach(() => {
  const views = [
    { conversationId:"chat",peerId:"peer", mode:"CONNECTED" as const,request:"NONE" as const,ownHidden:false },
    { conversationId:"request",peerId:"requester",mode:"REQUEST" as const,request:"INCOMING" as const,ownHidden:false },
    { conversationId:"archive",peerId:"archived",mode:"CONNECTED" as const,request:"NONE" as const,ownHidden:true },
  ].map(v=>({...v,requestEpoch:null,ownBlocked:false,ownDeclined:false,revision:1}));
  state.chat={accountId:"viewer",status:"ready",revision:1,error:null,threadSync:null,currentProjections:Object.fromEntries(views.map(v=>[v.conversationId,v])),conversations:views.map(v=>({conversationId:v.conversationId,peerId:v.peerId,cachedProjection:v,lastMessage:null,lastSequence:0,unreadCount:v.conversationId==="request"?2:0,pendingCount:0,updatedAt:0,projectionObservedAt:0}))};
  Object.defineProperty(window,"innerWidth",{value:1200,configurable:true});
});
afterEach(cleanup);
it("uses canonical thread links and retains the actual list/search owner across navigation", async () => {
  render(app());
  const link=await screen.findByRole("link",{name:"Open conversation with River Jones"});expect(link.getAttribute("href")).toBe("/chats/chat");
  const search=screen.getByRole("searchbox",{name:"Search people or chats"});
  fireEvent.change(search,{target:{value:"river"}});fireEvent.click(link);
  await waitFor(()=>expect(screen.getByTestId("location").textContent).toBe("/chats/chat"));
  expect(screen.getByRole("searchbox",{name:"Search people or chats"})).toBe(search);
  expect(search).toHaveProperty("value","river");
  expect(screen.getAllByTestId("route-transition")).toHaveLength(1);
});
it("counts visible incoming requests and separates archived/unread filters", async () => {
  render(app());await screen.findByRole("link",{name:"Open conversation with River Jones"});
  fireEvent.click(screen.getByRole("button",{name:"Requests, 1"}));
  expect(screen.getByRole("link",{name:"Open conversation with Robin Lane"})).toBeTruthy();expect(screen.queryByRole("link",{name:"Open conversation with River Jones"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"Filter chats"}));fireEvent.click(await screen.findByRole("menuitem",{name:"Archived"}));
  expect(screen.getByRole("link",{name:"Open conversation with Rowan Lee"})).toBeTruthy();expect(screen.queryByRole("link",{name:"Open conversation with Robin Lane"})).toBeNull();
});
it("mirrors the bubble direction for the reply swipe and names a quoted attachment", () => {
  // Your own bubble answers right-to-left; a received one left-to-right.
  expect(replySwipeFor(-71, true)).toBe(false);
  expect(replySwipeFor(-72, true)).toBe(true);
  expect(replySwipeFor(72, true)).toBe(false);
  expect(replySwipeFor(72, false)).toBe(true);
  expect(replySwipeFor(-72, false)).toBe(false);
  const base = { id: "message", conversationId: "chat", authorId: "peer", recipientId: "viewer", body: "" };
  expect(replyPreview({ ...base, messageType: "VOICE" })).toBe("Voice message");
  expect(replyPreview({ ...base, messageType: "MEDIA" })).toBe("Photo");
  expect(replyPreview({ ...base, messageType: "LOCATION" })).toBe("Location");
  expect(replyPreview({ ...base, body: "Kept text" })).toBe("Kept text");
  expect(replyPreview({ ...base, body: "Gone", unsentAt: 1 })).toBe("Message unsent");
});
it("groups only consecutive photos from one author inside the batch window", () => {
  const photo = (id: string, authorId: string, createdAt: number, extra: Partial<StoredHumanMessage> = {}): StoredHumanMessage => ({
    id, conversationId: "chat", authorId, recipientId: "other", body: "", messageType: "MEDIA", createdAt, ...extra });
  const text = (id: string, authorId: string, createdAt: number): StoredHumanMessage => ({
    id, conversationId: "chat", authorId, recipientId: "other", body: "hi", messageType: "TEXT", createdAt });
  const runs = photoBatches([
    photo("a1", "peer", 1_000), photo("a2", "peer", 2_500), photo("a3", "peer", 4_000),
    text("t1", "peer", 5_000),
    photo("b1", "peer", 6_000), photo("b2", "peer", 7_000),
    photo("c1", "viewer", 8_000), photo("c2", "viewer", 8_500),
    photo("d1", "peer", 9_000), photo("d2", "peer", 13_500),
    text("t2", "peer", 13_600),
    photo("e1", "peer", 14_000), photo("e2", "peer", 0),
    text("t3", "peer", 14_100),
    photo("f1", "peer", 15_000), photo("f2", "peer", 16_000, { unsentAt: 1 }), photo("f3", "peer", 17_000),
  ]);
  expect([...runs.batches.keys()]).toEqual(["a1", "b1", "c1"]);
  expect([...runs.followers].sort()).toEqual(["a2", "a3", "b2", "c2"]);
  expect(runs.leaderOf.get("a2")).toBe("a1");
  expect(runs.leaderOf.get("a3")).toBe("a1");
  // A text between photos, another author, a slow gap, an unknown timestamp and
  // an unsent photo all end the run instead of merging unrelated sends.
  expect(runs.followers.has("d2")).toBe(false);
  expect(runs.followers.has("e2")).toBe(false);
  expect(runs.followers.has("f2")).toBe(false);
  expect(runs.followers.has("f3")).toBe(false);
});
it.each(["/connections", "/connections/chat"])("replaces legacy %s with the canonical destination and preserves query/hash", async path => {
  function Probe(){const location=useLocation();return <p data-testid="redirect">{location.pathname+location.search+location.hash}</p>;}
  render(<MemoryRouter initialEntries={[`${path}?from=push#message`]}><Routes>
    <Route path="/connections" element={<LegacyChatsRedirect/>}/><Route path="/connections/:conversationId" element={<LegacyChatsRedirect/>}/>
    <Route path="/chats" element={<Probe/>}/><Route path="/chats/:conversationId" element={<Probe/>}/>
  </Routes></MemoryRouter>);
  await waitFor(()=>expect(screen.getByTestId("redirect").textContent).toBe(path.replace("connections","chats")+"?from=push#message"));
});
it("shows readable report context and a truthful local update time on a request row without nested links",async()=>{
  const row=state.chat.conversations.find(v=>v.conversationId==="request")!;
  row.updatedAt=new Date("2026-10-30T10:00:00Z").getTime();
  row.lastMessage={id:"message",conversationId:"request",authorId:"requester",recipientId:"viewer",body:"Is it yours?",messageType:"TEXT",contextReportId:"report"};
  render(app());fireEvent.click(screen.getByRole("button",{name:"Requests, 1"}));
  expect(await screen.findByText(/Blue wallet/)).toBeTruthy();
  const link=screen.getByRole("link",{name:"Open conversation with Robin Lane"});expect(link.querySelector("a")).toBeNull();
  expect(link.closest("li")?.querySelector("time")?.getAttribute("datetime")).toBe("2026-10-30T10:00:00.000Z");
});
