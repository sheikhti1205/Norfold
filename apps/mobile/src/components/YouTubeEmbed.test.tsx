// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { YouTubeEmbed } from "./YouTubeEmbed";

afterEach(cleanup);

describe("YouTubeEmbed link safety", () => {
  it.each([
    "javascript:alert(1)//youtube.com/watch?v=dQw4w9WgXcQ",
    "https://evil.test/youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://youtube.com/watch?v=dQw4w9WgXcQextra",
  ])("renders no embed or link for untrusted input: %s", (url) => {
    const { container } = render(<YouTubeEmbed url={url} />);
    expect(container.childElementCount).toBe(0);
  });

  it("uses a canonical watch link and fixed embed origin", async () => {
    render(<YouTubeEmbed url="https://youtu.be/dQw4w9WgXcQ?si=untrusted-tracking#fragment" />);
    expect(screen.getByRole("link", { name: "Watch on YouTube" }).getAttribute("href"))
      .toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    const player = await screen.findByTitle("Embedded YouTube video");
    expect(player.getAttribute("src")).toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
  });

  it("opens a larger pop-out player and closes it with Escape", async () => {
    render(<YouTubeEmbed url="https://www.youtube.com/watch?v=dQw4w9WgXcQ" />);
    // Nothing is embedded before a deliberate press.
    expect(screen.queryByTitle("Embedded YouTube video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Watch larger" }));
    const dialog = await screen.findByRole("dialog", { name: "Video player" });
    expect(dialog).toBeTruthy();
    expect(screen.getByTitle("Embedded YouTube video").getAttribute("src"))
      .toBe("https://www.youtube.com/embed/dQw4w9WgXcQ");
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Video player" })).toBeNull());
  });

  it("keeps the external fallback reachable from the pop-out", async () => {
    render(<YouTubeEmbed url="https://youtu.be/dQw4w9WgXcQ" />);
    fireEvent.click(screen.getByRole("button", { name: "Watch larger" }));
    await screen.findByRole("dialog", { name: "Video player" });
    const links = screen.getAllByRole("link", { name: "Watch on YouTube" });
    expect(links.at(-1)?.getAttribute("href")).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    expect(links.at(-1)?.getAttribute("target")).toBe("_blank");
  });

  it("unmounts the inline player while the pop-out is open", async () => {
    render(<YouTubeEmbed url="https://youtube.com/watch?v=dQw4w9WgXcQ" />);
    fireEvent.click(screen.getByRole("button", { name: "Play video" }));
    await screen.findByTitle("Embedded YouTube video");

    fireEvent.click(screen.getByRole("button", { name: "Watch larger" }));
    await screen.findByRole("dialog", { name: "Video player" });

    // Two frames would mean two downloads and two audio tracks.
    await waitFor(() => expect(screen.getAllByTitle("Embedded YouTube video")).toHaveLength(1));
  });
});
