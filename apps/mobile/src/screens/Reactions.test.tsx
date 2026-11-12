// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Reactions } from "./Reactions";

vi.mock("../components/AppBar", () => ({ AppBar: ({ title }: { title: string }) => <h1>{title}</h1> }));
afterEach(cleanup);

it("does not mistake unavailable reaction lists for empty lists", () => {
  render(<Reactions />);
  expect(screen.getByText("Your liked reports are not available here yet.")).toBeTruthy();
  expect(screen.getByText("Your disliked reports are not available here yet.")).toBeTruthy();
  expect(screen.queryByText("No liked reports yet")).toBeNull();
  expect(screen.queryByText("No disliked reports yet")).toBeNull();
});
