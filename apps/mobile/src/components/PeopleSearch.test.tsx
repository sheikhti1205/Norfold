// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PeopleSearchPage } from "../services/people";
const state = vi.hoisted(() => ({
  account:"viewer", search:vi.fn(), chatAccount:"viewer",
  projections:null as Record<string, unknown> | null,
  conversations:[] as Array<{ peerId:string; cachedProjection?:unknown }>,
  chatStatus:"ready" as "closed" | "opening" | "ready" | "offline" | "error",
}));
const suggestions = vi.hoisted(() => ({ feed:vi.fn(), identities:vi.fn() }));
vi.mock("../auth", () => ({useAuth:()=>({user:{id:state.account}})}));
vi.mock("../services/messaging/useMessaging", () => ({ useMessaging: () => ({
  accountId:state.chatAccount, currentProjections:state.projections,
  conversations:state.conversations, status:state.chatStatus,
}) }));
vi.mock("../services/people",async original=>({...await original<typeof import("../services/people")>(),searchPeople:(...args:unknown[])=>state.search(...args)}));
vi.mock("../services/posts", () => ({ fetchFeed: (...args:unknown[]) => suggestions.feed(...args) }));
vi.mock("../services/accountLabels", () => ({ fetchAccountIdentities: (...args:unknown[]) => suggestions.identities(...args) }));
import { PeopleSearch } from "./PeopleSearch";
const river={id:"peer",username:"river",displayName:"River Lee",avatarUrl:null};
const cursor={query:"river",rank:1,username:"river",id:"peer"};
const view=(query:string)=><MemoryRouter><PeopleSearch query={query}/></MemoryRouter>;
function reportBy(author:{id:string;username:string;displayName?:string|null}, blockedAuthor=false){
  return { id:`post-${author.id}`, blockedAuthor, author:{avatarUrl:null,displayName:null,emailVerified:true,phoneVerified:false,createdAt:"2026-01-01T00:00:00.000Z",...author} };
}
async function flushed(){await act(async()=>{});}
async function tick(){await act(async()=>{vi.advanceTimersByTime(250);});}
beforeEach(()=>{
  vi.useFakeTimers();state.account="viewer";state.chatAccount="viewer";state.projections=null;
  state.conversations=[];state.chatStatus="ready";
  state.search.mockReset().mockResolvedValue({items:[river],nextCursor:null});
  suggestions.feed.mockReset().mockResolvedValue({items:[],nextCursor:null,total:0});
  suggestions.identities.mockReset().mockResolvedValue(new Map());
});
afterEach(()=>{cleanup();vi.useRealTimers();});
it("does not search empty input and debounces before showing public-profile rows",async()=>{
  const mount=render(view(" @ "));await tick();expect(state.search).not.toHaveBeenCalled();
  mount.rerender(view(" @River "));expect(state.search).not.toHaveBeenCalled();await tick();
  expect(screen.getByRole("link",{name:/River Lee @river/}).getAttribute("href")).toBe("/u/river");
  // The people directory carries the one person card too, so a tap on a phone
  // opens it here as well.
  expect(screen.getByRole("link",{name:/River Lee @river/}).closest(".fb-profile-preview-trigger")).toBeTruthy();
  expect(screen.queryByRole("button",{name:"Connect"})).toBeNull();
});
it("aborts stale queries and never paints a response that ignores abort",async()=>{
  let resolve!:(page:PeopleSearchPage)=>void;
  state.search.mockReturnValueOnce(new Promise<PeopleSearchPage>(done=>{resolve=done;}));
  const mount=render(view("river"));await tick();const signal=state.search.mock.calls[0]?.[1].signal as AbortSignal;
  mount.rerender(view("other"));expect(signal.aborted).toBe(true);
  await act(async()=>{resolve({items:[river],nextCursor:null});});
  expect(screen.queryByRole("link",{name:/River Lee/})).toBeNull();
});
it("replaces the search lifetime and removes prior-account rows synchronously",async()=>{
  const mount=render(view("river"));await tick();expect(screen.getByText("@river")).toBeTruthy();
  const signal=state.search.mock.calls[0]?.[1].signal as AbortSignal;
  state.account="replacement";mount.rerender(view("river"));
  expect(screen.queryByText("@river")).toBeNull();expect(signal.aborted).toBe(true);
});
it("appends bounded cursor pages without duplicate rows or losing earlier results",async()=>{
  state.search.mockResolvedValueOnce({items:[river],nextCursor:cursor})
    .mockResolvedValueOnce({items:[river,{...river,id:"other",username:"riverbank"}],nextCursor:null});
  render(view("river"));await tick();fireEvent.click(screen.getByRole("button",{name:"Load more people"}));
  await act(async()=>{});
  expect(screen.getAllByRole("link")).toHaveLength(2);
  expect(state.search.mock.calls[1]?.[1].cursor).toEqual(cursor);
  expect(screen.queryByRole("button",{name:"Load more people"})).toBeNull();
});
it("offers a truthful retry after failure and announces an empty result",async()=>{
  state.search.mockRejectedValueOnce(new Error("private backend error")).mockResolvedValueOnce({items:[],nextCursor:null});
  render(view("river"));await tick();expect(screen.getByRole("alert").textContent).not.toContain("private backend");
  fireEvent.click(screen.getByRole("button",{name:"Try again"}));await act(async()=>{});
  expect(screen.getByRole("status").textContent).toMatch(/no people found/i);
});
it("shows viewer-authorized relationship state without exposing the counterpart's private decisions",async()=>{
  state.projections={chat:{peerId:"peer",mode:"REQUEST",request:"OUTGOING",ownBlocked:false}};
  const mount=render(view("river"));await tick();expect(screen.getByText("Request sent")).toBeTruthy();
  state.projections={chat:{peerId:"peer",mode:"CONNECTED",request:"NONE",ownBlocked:false}};
  mount.rerender(view("river"));expect(screen.getByText("Friends")).toBeTruthy();
  state.chatAccount="other";mount.rerender(view("river"));expect(screen.queryByText("Friends")).toBeNull();
});
it("suggests chat peers and report authors when the query is empty",async()=>{
  state.projections={chat:{conversationId:"c1",peerId:"peer",mode:"CONNECTED",request:"NONE",ownBlocked:false}};
  suggestions.identities.mockResolvedValue(new Map([["peer",river]]));
  suggestions.feed.mockResolvedValue({items:[
    reportBy({id:"author",username:"sam_r",displayName:"Sam Rivera"}),
    reportBy({id:"viewer",username:"me"}),
    reportBy({id:"blocked",username:"blocked_person"},true),
    reportBy({id:"author",username:"sam_r",displayName:"Sam Rivera"}),
  ],nextCursor:null,total:4});
  render(view(""));await flushed();
  expect(screen.getByRole("heading",{name:"Suggested people"})).toBeTruthy();
  expect(screen.getByRole("link",{name:/River Lee @river/}).getAttribute("href")).toBe("/u/river");
  expect(screen.getByText("Friends")).toBeTruthy();
  expect(screen.getByText("@sam_r")).toBeTruthy();
  expect(screen.queryByText("@me")).toBeNull();
  expect(screen.queryByText("@blocked_person")).toBeNull();
  expect(screen.getAllByText("@sam_r")).toHaveLength(1);
  expect(state.search).not.toHaveBeenCalled();
});
it("says honestly when there is nobody to suggest yet",async()=>{
  render(view(""));await flushed();
  expect(screen.getByRole("heading",{name:"No one to suggest yet"})).toBeTruthy();
  expect(screen.getByText(/search by name or @username/i)).toBeTruthy();
});
it("suggests a cached chat peer before the live projection set arrives",async()=>{
  // Cold Connect: the local conversation index is already on the device and
  // names the peer, so the page does not have to wait for a network refresh.
  state.projections=null;
  state.conversations=[
    {peerId:"peer",cachedProjection:{conversationId:"c1",peerId:"peer",mode:"CONNECTED",request:"NONE",ownBlocked:false}},
    {peerId:"blocked_peer",cachedProjection:{conversationId:"c2",peerId:"blocked_peer",mode:"CONNECTED",request:"NONE",ownBlocked:true}},
  ];
  suggestions.identities.mockResolvedValue(new Map([
    ["peer",river],
    ["blocked_peer",{id:"blocked_peer",username:"gone",displayName:"Gone",avatarUrl:null}],
  ]));
  render(view(""));await flushed();
  expect(screen.getByRole("link",{name:/River Lee @river/})).toBeTruthy();
  expect(screen.getByText("Friends")).toBeTruthy();
  expect(screen.queryByText("@gone")).toBeNull();
});
it("waits for the chat runtime instead of claiming there is nobody",async()=>{
  // Before the runtime has read its local index, an empty list is not proof
  // there are no people: the empty state must not flash first.
  state.chatStatus="opening";
  const mount=render(view(""));await flushed();
  expect(screen.queryByRole("heading",{name:"No one to suggest yet"})).toBeNull();
  expect(screen.getByText("Finding people…")).toBeTruthy();
  state.chatStatus="ready";
  state.conversations=[{peerId:"peer",cachedProjection:{conversationId:"c1",peerId:"peer",mode:"CONNECTED",request:"NONE",ownBlocked:false}}];
  suggestions.identities.mockResolvedValue(new Map([["peer",river]]));
  mount.rerender(view(""));await flushed();
  expect(screen.getByRole("link",{name:/River Lee @river/})).toBeTruthy();
});
it("keeps loaded suggestions when the chat identity read fails",async()=>{
  state.projections={chat:{conversationId:"c1",peerId:"peer",mode:"CONNECTED",request:"NONE",ownBlocked:false}};
  suggestions.identities.mockRejectedValue(new Error("no identities"));
  suggestions.feed.mockResolvedValue({items:[reportBy({id:"author",username:"sam_r"})],nextCursor:null,total:1});
  render(view(""));await flushed();
  expect(screen.getByText("@sam_r")).toBeTruthy();
  expect(screen.queryByText("Couldn't load suggestions.")).toBeNull();
});
