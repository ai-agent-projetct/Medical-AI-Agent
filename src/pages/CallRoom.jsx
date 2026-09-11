import React, { useEffect, useRef, useState } from 'react';
import { ZegoUIKitPrebuilt } from '@zegocloud/zego-uikit-prebuilt';
import { Video } from 'lucide-react';
import { callLink } from '../firebase';

const appID = Number(import.meta.env.VITE_ZEGO_APP_ID);
// ponytail: test token minted in the browser (server secret ships in the bundle). Before going live,
// mint Zego Token04 in a Cloud Function and pass it to ZegoUIKitPrebuilt.create() instead.
const serverSecret = import.meta.env.VITE_ZEGO_SERVER_SECRET;

/**
 * Public video room at #/call/<appointmentId>. The doctor (mobile app or portal) and the patient
 * (via the shared link) join the same ZegoCloud room, whose id is the appointment id.
 * Optional ?name= prefills the display name (the mobile app passes the doctor's name).
 */
export default function CallRoom({ roomId, presetName = '' }) {
  const container = useRef(null);
  const [name, setName] = useState(presetName);
  const [joined, setJoined] = useState(Boolean(presetName));
  const [left, setLeft] = useState(false);

  useEffect(() => {
    if (!joined || !container.current || !appID || !serverSecret) return undefined;
    const userId = `${name.replace(/\W/g, '').slice(0, 20) || 'guest'}_${Date.now() % 100000}`;
    const token = ZegoUIKitPrebuilt.generateKitTokenForTest(appID, serverSecret, roomId, userId, name);
    const zp = ZegoUIKitPrebuilt.create(token);
    zp.joinRoom({
      container: container.current,
      scenario: { mode: ZegoUIKitPrebuilt.OneONoneCall },
      sharedLinks: [{ name: 'Patient link', url: callLink(roomId) }],
      showScreenSharingButton: false,
      onLeaveRoom: () => setLeft(true),
    });
    return () => zp.destroy();
  }, [joined, roomId, name]);

  const shell = { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-main, #f5f6fb)' };

  if (!appID || !serverSecret) {
    return <div style={shell}><div className="card" style={{ maxWidth: 420 }}>Video calls are not configured. Set VITE_ZEGO_APP_ID and VITE_ZEGO_SERVER_SECRET.</div></div>;
  }
  if (left) {
    return <div style={shell}><div className="card" style={{ maxWidth: 420, textAlign: 'center' }}><h3>Consultation ended</h3><p style={{ color: 'var(--text-muted)' }}>You can close this tab.</p></div></div>;
  }
  if (!joined) {
    return (
      <div style={shell}>
        <form className="card" style={{ width: 380 }} onSubmit={(e) => { e.preventDefault(); if (name.trim()) setJoined(true); }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
            <Video size={22} style={{ color: 'var(--primary)' }} />
            <h3 style={{ margin: 0 }}>Join video consultation</h3>
          </div>
          <div className="form-group">
            <label htmlFor="call-name">Your name</label>
            <input id="call-name" className="form-input" required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>Join call</button>
        </form>
      </div>
    );
  }
  return <div ref={container} style={{ width: '100vw', height: '100vh' }} />;
}
