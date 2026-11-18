import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "react-aria-components";
import { Camera } from "lucide-react";
import { AdaptiveTaskSurface } from "./AdaptiveTaskSurface";
import "./CameraCapture.css";

type CameraStatus = "opening" | "live" | "blocked" | "missing" | "unsupported" | "failed";

export interface CameraCaptureProps {
  open: boolean;
  onClose: () => void;
  /** The bounded capture handed to the caller's existing photo pipeline. */
  onCapture: (file: File) => void;
  /** Opens the normal gallery picker; the camera stays a camera, never a relabelled file dialog. */
  onChoosePhoto?: () => void;
}

function statusCopy(status: CameraStatus): string {
  switch (status) {
    case "blocked": return "Camera access is blocked. Allow camera access in your browser, or choose a photo instead.";
    case "missing": return "No camera was found on this device. Choose a photo instead.";
    case "unsupported": return "This browser can't open the camera here. Choose a photo instead.";
    case "failed": return "The camera couldn't start. Try again, or choose a photo instead.";
    case "opening": return "Starting camera…";
    case "live": return "";
  }
}

function failureStatus(error: unknown): CameraStatus {
  const name = typeof error === "object" && error !== null ? (error as { name?: unknown }).name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "blocked";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "missing";
  return "failed";
}

/**
 * One real camera surface for the web build.
 *
 * The Android build already captures through the native media plugin; this
 * dialog exists for every other runtime, where a `capture` file input is just
 * a gallery picker on a desktop browser. It opens the actual camera, shows the
 * live preview, lets the reader switch between front and rear cameras when
 * more than one exists, and hands a JPEG File to the surface's existing photo
 * preparation path. Permission, missing-device and unsupported states are
 * explicit and always leave "Choose photo" as a working way forward.
 */
export function CameraCapture({ open, onClose, onCapture, onChoosePhoto }: CameraCaptureProps) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const run = useRef(0);
  const shotUrl = useRef<string | null>(null);
  const [status, setStatus] = useState<CameraStatus>("opening");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [switchable, setSwitchable] = useState(false);
  const [shot, setShot] = useState<{ file: File; url: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [ready, setReady] = useState(false);

  const stopStream = useCallback(() => {
    const current = stream.current;
    stream.current = null;
    if (current) for (const track of current.getTracks()) track.stop();
    if (video.current) video.current.srcObject = null;
  }, []);

  const releaseShot = useCallback(() => {
    if (shotUrl.current) URL.revokeObjectURL(shotUrl.current);
    shotUrl.current = null;
  }, []);

  const start = useCallback(async (mode: "environment" | "user") => {
    const id = ++run.current;
    stopStream();
    releaseShot();
    setShot(null);
    setStatus("opening");
    setSwitchable(false);
    setReady(false);
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    if (!media?.getUserMedia) {
      setStatus("unsupported");
      return;
    }
    try {
      const next = await media.getUserMedia({
        audio: false,
        video: { facingMode: mode, width: { ideal: 1600 }, height: { ideal: 1200 } },
      });
      if (run.current !== id) {
        for (const track of next.getTracks()) track.stop();
        return;
      }
      stream.current = next;
      if (video.current) {
        video.current.srcObject = next;
        await video.current.play().catch(() => undefined);
      }
      if (run.current !== id) return;
      setStatus("live");
      try {
        const devices = await media.enumerateDevices();
        if (run.current === id) setSwitchable(devices.filter((device) => device.kind === "videoinput").length > 1);
      } catch {
        // Device labels are a nice-to-have; capture already works.
      }
    } catch (error) {
      if (run.current === id) setStatus(failureStatus(error));
    }
  }, [releaseShot, stopStream]);

  useEffect(() => {
    if (!open) {
      run.current += 1;
      stopStream();
      releaseShot();
      setShot(null);
      return;
    }
    setFacing("environment");
    void start("environment");
    return () => {
      run.current += 1;
      stopStream();
    };
  }, [open, releaseShot, start, stopStream]);

  useEffect(() => () => {
    run.current += 1;
    stopStream();
    releaseShot();
  }, [releaseShot, stopStream]);

  function close() {
    run.current += 1;
    stopStream();
    releaseShot();
    setShot(null);
    onClose();
  }

  function capture() {
    const element = video.current;
    if (!element || element.videoWidth <= 0 || element.videoHeight <= 0 || capturing) return;
    const id = run.current;
    setCapturing(true);
    const width = element.videoWidth;
    const height = element.videoHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      setCapturing(false);
      setStatus("failed");
      return;
    }
    if (facing === "user") {
      context.translate(width, 0);
      context.scale(-1, 1);
    }
    context.drawImage(element, 0, 0, width, height);
    canvas.toBlob((blob) => {
      setCapturing(false);
      if (run.current !== id) return;
      if (!blob) {
        setStatus("failed");
        return;
      }
      const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      const url = URL.createObjectURL(blob);
      releaseShot();
      shotUrl.current = url;
      setShot({ file, url });
      // The review still is the subject now; turn the camera off until Retake.
      run.current += 1;
      stopStream();
    }, "image/jpeg", 0.92);
  }

  function retake() {
    releaseShot();
    setShot(null);
    void start(facing);
  }

  function useShot() {
    if (!shot) return;
    const file = shot.file;
    onCapture(file);
    close();
  }

  function flip() {
    const next = facing === "environment" ? "user" : "environment";
    setFacing(next);
    void start(next);
  }

  function choosePhoto() {
    close();
    onChoosePhoto?.();
  }

  const unavailable = status !== "live" && status !== "opening";
  const footer = shot ? <>
    <Button className="fb-surface-button" onPress={retake}>Retake</Button>
    <Button className="fb-surface-button fb-confirm-primary" onPress={useShot}>Use photo</Button>
  </> : <>
    {onChoosePhoto && <Button className="fb-surface-button" onPress={choosePhoto}>Choose photo</Button>}
    {status === "opening"
      ? <Button className="fb-surface-button fb-confirm-primary" isDisabled>Starting…</Button>
      : unavailable
        ? <Button className="fb-surface-button fb-confirm-primary" onPress={() => void start(facing)}>Try again</Button>
        : <Button className="fb-surface-button fb-confirm-primary fb-camera-take" onPress={capture} isDisabled={capturing || !ready}>
            <Camera size={18} aria-hidden="true" /> Take photo
          </Button>}
  </>;

  return <AdaptiveTaskSurface open={open} onClose={close} title="Take photo" width="standard"
    bodyClassName="fb-camera-body" footer={footer}>
    <div className="fb-camera-stage">
      <video ref={video} className="fb-camera-video" data-mirror={facing === "user" ? "true" : undefined}
        data-hidden={shot ? "true" : undefined} autoPlay muted playsInline aria-label="Camera preview"
        onLoadedMetadata={() => setReady(true)} />
      {shot && <img src={shot.url} alt="Captured photo" data-mirror={facing === "user" ? "true" : undefined} />}
      {(status === "opening" || unavailable) && <p className="fb-camera-status" role="status">{statusCopy(status)}</p>}
    </div>
    {status === "live" && !shot && switchable && (
      <button type="button" className="fb-camera-switch" onClick={flip}>
        Switch camera
      </button>
    )}
  </AdaptiveTaskSurface>;
}
