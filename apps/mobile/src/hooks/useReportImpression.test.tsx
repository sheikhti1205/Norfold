// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReportImpression } from "./useReportImpression";

const record = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("../services/reportViews", () => ({ recordReportView: record }));

class CapturingObserver {
  static created: CapturingObserver[] = [];
  readonly callback: IntersectionObserverCallback;
  disconnected = false;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    CapturingObserver.created.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() { this.disconnected = true; }
}

function entry(isIntersecting: boolean): IntersectionObserverEntry {
  return { isIntersecting } as IntersectionObserverEntry;
}

function Probe({ id }: { id: string }) {
  const ref = useReportImpression(id);
  return <div ref={ref} data-testid="probe" />;
}

describe("useReportImpression", () => {
  afterEach(() => {
    cleanup();
    record.mockClear();
    CapturingObserver.created = [];
    vi.unstubAllGlobals();
  });

  it("records nothing until half the card is on screen", () => {
    vi.stubGlobal("IntersectionObserver", CapturingObserver);
    render(<Probe id="report-1" />);
    const observer = CapturingObserver.created[0]!;
    observer.callback([entry(false)], observer as unknown as IntersectionObserver);
    expect(record).not.toHaveBeenCalled();
    observer.callback([entry(true)], observer as unknown as IntersectionObserver);
    expect(record).toHaveBeenCalledExactlyOnceWith("report-1");
    expect(observer.disconnected).toBe(true);
  });

  it("never records the same card twice from one mount", () => {
    vi.stubGlobal("IntersectionObserver", CapturingObserver);
    render(<Probe id="report-1" />);
    const observer = CapturingObserver.created[0]!;
    observer.callback([entry(true)], observer as unknown as IntersectionObserver);
    observer.callback([entry(true)], observer as unknown as IntersectionObserver);
    expect(record).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the runtime has no IntersectionObserver", () => {
    vi.stubGlobal("IntersectionObserver", undefined);
    render(<Probe id="report-1" />);
    expect(CapturingObserver.created).toHaveLength(0);
    expect(record).not.toHaveBeenCalled();
  });
});
