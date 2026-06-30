import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import "./Auth.css";

const DISCLAIMER_VERSION = 1;
const inviteToken = new URLSearchParams(window.location.search).get("invite");

// Gate: renders children({profile, signOut}) only when logged in, in an org, disclaimer accepted, org active.
export default function Auth({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [profile, setProfile] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s ?? null));
    return () => sub.subscription.unsubscribe();
  }, []);

  const loadProfile = async (uid) => {
    const { data } = await supabase.from("profiles").select("*, org:orgs(*)").eq("id", uid).maybeSingle();
    setProfile(data ?? null);
  };

  useEffect(() => {
    if (session === undefined) return;
    if (!session) { setProfile(null); return; }
    setProfile(undefined);
    loadProfile(session.user.id);
  }, [session]);

  const signOut = () => supabase.auth.signOut();

  if (session === undefined || (session && profile === undefined)) return <Splash />;
  if (!session) return <AuthScreen />;
  if (!profile) return <Onboarding session={session} onDone={() => loadProfile(session.user.id)} signOut={signOut} />;
  if (!profile.disclaimer_accepted_at) return <DisclaimerGate onAccept={() => loadProfile(session.user.id)} signOut={signOut} />;
  if (!["active", "trialing"].includes(profile.org?.subscription_status))
    return <Locked org={profile.org} signOut={signOut} />;
  return children({ profile, signOut });
}

function Splash() {
  return <div className="auth"><div className="auth-card"><div className="auth-logo">▦ Yardscout</div><div className="auth-spin" /></div></div>;
}

function AuthScreen() {
  const [mode, setMode] = useState("login"); // login | signup | reset
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({ email, password: pw });
        if (error) throw error;
        if (!data.session) setMsg("Check your email to confirm your account, then come back and log in.");
      } else if (mode === "reset") {
        const { error } = await supabase.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setMsg("Password reset link sent to your email.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password: pw });
        if (error) throw error;
      }
    } catch (err) { setMsg(err.message || "Something went wrong."); }
    setBusy(false);
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">▦ Yardscout</div>
        <div className="auth-sub">{inviteToken ? "Sign in to join your team" : mode === "signup" ? "Create your account" : "Sign in"}</div>
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" />
        {mode !== "reset" && <input type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} required autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={6} />}
        <button className="auth-btn" disabled={busy}>{busy ? "…" : mode === "signup" ? "Sign up" : mode === "reset" ? "Send reset link" : "Log in"}</button>
        {msg && <div className="auth-msg">{msg}</div>}
        <div className="auth-links">
          {mode !== "login" && <button type="button" onClick={() => { setMode("login"); setMsg(""); }}>Log in</button>}
          {mode !== "signup" && <button type="button" onClick={() => { setMode("signup"); setMsg(""); }}>Create account</button>}
          {mode !== "reset" && <button type="button" onClick={() => { setMode("reset"); setMsg(""); }}>Forgot password</button>}
        </div>
      </form>
    </div>
  );
}

function Onboarding({ session, onDone, signOut }) {
  const [name, setName] = useState("");
  const [org, setOrg] = useState("");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg("");
    try {
      if (inviteToken) {
        const { error } = await supabase.rpc("accept_invite", { invite_token: inviteToken, member_name: name });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc("create_org", { org_name: org, owner_name: name });
        if (error) throw error;
      }
      await onDone();
    } catch (err) { setMsg(err.message || "Something went wrong."); setBusy(false); }
  };

  return (
    <div className="auth">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">▦ Yardscout</div>
        <div className="auth-sub">{inviteToken ? "Join your team" : "Set up your company"}</div>
        <input placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} required />
        {!inviteToken && <input placeholder="Company name" value={org} onChange={(e) => setOrg(e.target.value)} required />}
        <button className="auth-btn" disabled={busy}>{busy ? "…" : inviteToken ? "Join" : "Create company"}</button>
        {msg && <div className="auth-msg">{msg}</div>}
        <div className="auth-links"><button type="button" onClick={signOut}>Sign out</button></div>
      </form>
    </div>
  );
}

function DisclaimerGate({ onAccept, signOut }) {
  const [busy, setBusy] = useState(false);
  const accept = async () => {
    setBusy(true);
    await supabase.rpc("accept_disclaimer", { version: DISCLAIMER_VERSION });
    await onAccept();
  };
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-logo">▦ Yardscout</div>
        <div className="auth-sub">Before you start</div>
        <p className="auth-disc">Yardscout's green / yellow / red fit results are <b>estimates from public county
          data</b> — they are not a guarantee. Always verify a yard on site (access, slope, fences, utilities)
          before committing. You're responsible for confirming a placement actually works.</p>
        <button className="auth-btn" disabled={busy} onClick={accept}>I understand</button>
        <div className="auth-links"><button type="button" onClick={signOut}>Sign out</button></div>
      </div>
    </div>
  );
}

function Locked({ org, signOut }) {
  return (
    <div className="auth">
      <div className="auth-card">
        <div className="auth-logo">▦ Yardscout</div>
        <div className="auth-sub">Account {org?.subscription_status || "inactive"}</div>
        <p className="auth-disc">This account isn't active right now. Contact your administrator to restart it.</p>
        <div className="auth-links"><button type="button" onClick={signOut}>Sign out</button></div>
      </div>
    </div>
  );
}
