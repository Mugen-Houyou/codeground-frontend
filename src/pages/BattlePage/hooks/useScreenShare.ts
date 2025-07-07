import { useCallback, useState, useEffect } from "react";
import {
  localStream as sharedLocalStream,
  remoteStream as sharedRemoteStream,
  setLocalStream,
  peerConnection as sharedPC,
} from "@/utils/webrtcStore";
import useWebSocketStore from "@/stores/websocketStore";

const useScreenShare = (
  remoteVideoRef: React.RefObject<HTMLVideoElement>,
  localVideoRef: React.RefObject<HTMLVideoElement>,
  createPeerConnection: () => RTCPeerConnection,
) => {
  const { sendMessage } = useWebSocketStore();
  const [isLocalStreamActive, setIsLocalStreamActive] = useState(true);
  const [showLocalScreenSharePrompt, setShowLocalScreenSharePrompt] =
    useState(false);
  const [isRemoteStreamActive, setIsRemoteStreamActive] = useState(true);
  const [showRemoteScreenSharePrompt, setShowRemoteScreenSharePrompt] =
    useState(false);

  useEffect(() => {
    if (localVideoRef.current && sharedLocalStream) {
      localVideoRef.current.srcObject = sharedLocalStream;
    }
    if (remoteVideoRef.current && sharedRemoteStream) {
      remoteVideoRef.current.srcObject = sharedRemoteStream;
    }
  }, [localVideoRef, remoteVideoRef]);

  const cleanupScreenShare = useCallback(() => {
    if (sharedLocalStream) {
      sharedLocalStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
      setIsLocalStreamActive(false);
      setShowLocalScreenSharePrompt(true);
      sendMessage(JSON.stringify({ type: "screen_share_stopped" }));
    }
  }, [sendMessage]);

  const startLocalScreenShare = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      setLocalStream(stream);
      setIsLocalStreamActive(true);
      setShowLocalScreenSharePrompt(false);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      let pc = sharedPC;
      if (!pc) {
        pc = createPeerConnection();
      }
      pc.getSenders().forEach((sender) => {
        if (sender.track && sender.track.kind === "video") {
          pc.removeTrack(sender);
        }
      });
      stream.getTracks().forEach((track) => {
        pc.addTrack(track, stream);
      });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      sendMessage(
        JSON.stringify({ type: "webrtc_signal", signal: pc.localDescription }),
      );
      sendMessage(JSON.stringify({ type: "screen_share_started" }));
      stream.getVideoTracks()[0].onended = () => {
        cleanupScreenShare();
      };
    } catch (error) {
      console.error("Error starting screen share:", error);
      setShowLocalScreenSharePrompt(true);
    }
  }, [createPeerConnection, sendMessage, cleanupScreenShare, localVideoRef]);

  return {
    startLocalScreenShare,
    cleanupScreenShare,
    isLocalStreamActive,
    showLocalScreenSharePrompt,
    isRemoteStreamActive,
    showRemoteScreenSharePrompt,
    setIsRemoteStreamActive,
    setShowRemoteScreenSharePrompt,
  };
};

export default useScreenShare;
