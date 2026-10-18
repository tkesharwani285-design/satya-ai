import { useRef, useState } from 'react';
import Header, { useHealth } from './components/Header.jsx';
import Hero from './components/Hero.jsx';
import Flow from './components/Flow.jsx';
import Loading from './components/Loading.jsx';
import ErrorCard from './components/ErrorCard.jsx';
import Results from './components/Results.jsx';
import Extras from './components/Extras.jsx';
import AuthModal from './components/AuthModal.jsx';
import CaptchaModal from './components/CaptchaModal.jsx';
import { verifyUrl, verifyText, verifyMedia, verifyAudio, getBotRisk } from './services/api.js';
import { adaptUrl, adaptText, adaptMedia, adaptAudio } from './lib/adapt.js';
import { DEMOS, DEMO_CHIPS } from './data/demo.js';

const FIRST_TAB = { url: "checks", text: "checks", image: "temporal", audio: "audio" }; // result tab opened per input type
const HERO_TAB = { temporal: "image", ling: "text", bot: "url", audio: "audio" };      // feature card -> input type
const URL_IN_TEXT = /https?:\/\/[^\s<>"')\]]+/i;
const scrollTo = (id, block = "start") => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block }), 50);

export default function App() {
  const [loading, setLoading] = useState(false);
  const [loadingMode, setLoadingMode] = useState("url");
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);          // { message, kind } | null
  const [tab, setTab] = useState("temporal");        // active tab in the results dashboard
  const [heroTab, setHeroTab] = useState("url");     // active input type in the hero form
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem("satya_user")); } catch (e) { return null; } });
  const [authOpen, setAuthOpen] = useState(false);
  const [pending, setPending] = useState(null);
  const [human, setHuman] = useState(false);
  const abortRef = useRef(null);
  const lastRun = useRef(null);
  const health = useHealth();

  const login = (u, remember) => { setUser(u); setAuthOpen(false); try { remember ? localStorage.setItem("satya_user", JSON.stringify(u)) : localStorage.removeItem("satya_user"); } catch (e) {} };
  const logout = () => { setUser(null); try { localStorage.removeItem("satya_user"); } catch (e) {} };

  /** Calls the backend for one input type and stores the adapted result (or an error message). */
  const execute = async (mode, payload) => {
    abortRef.current?.abort();                       // a newer request replaces any in-flight one
    const ac = new AbortController();
    abortRef.current = ac;
    const opts = { signal: ac.signal };
    lastRun.current = { mode, payload };
    setLoading(true); setLoadingMode(mode); setResult(null); setError(null);
    scrollTo("results-anchor");
    try {
      let vm;
      if (mode === "url") {
        // Bot-risk runs alongside; if it fails (e.g. no social-data provider) the rest of the report still shows.
        const [main, bot] = await Promise.allSettled([verifyUrl(payload, opts), getBotRisk(payload, undefined, opts)]);
        if (main.status === "rejected") throw main.reason;
        vm = adaptUrl(main.value, payload, bot.status === "fulfilled" ? bot.value : null, bot.status === "rejected" ? bot.reason?.message : null);
      } else if (mode === "text") {
        const link = payload.match(URL_IN_TEXT)?.[0];
        const [main, bot] = await Promise.allSettled([verifyText(payload, opts), link ? getBotRisk(link, undefined, opts) : Promise.resolve(null)]);
        if (main.status === "rejected") throw main.reason;
        vm = adaptText(main.value, payload, bot.status === "fulfilled" ? bot.value : null, bot.status === "rejected" ? bot.reason?.message : null);
      } else if (mode === "image") {
        const fd = new FormData();
        fd.append("file", payload.file);
        if (payload.claimedDate) fd.append("claimed_date", payload.claimedDate);
        vm = adaptMedia(await verifyMedia(fd, opts), payload.file.name, payload.claimedDate);
      } else {
        const fd = new FormData();
        fd.append("file", payload.file);
        vm = adaptAudio(await verifyAudio(fd, opts), payload.file.name);
      }
      if (ac.signal.aborted) return;
      setResult(vm); setTab(FIRST_TAB[mode]);
    } catch (e) {
      if (ac.signal.aborted || e?.kind === "aborted") return;
      setError({ message: e?.message || "Something went wrong. Please try again.", kind: e?.kind });
    } finally {
      if (abortRef.current === ac) { abortRef.current = null; setLoading(false); }
    }
  };

  const demo = (id) => {
    abortRef.current?.abort(); abortRef.current = null;
    setLoading(false); setError(null); setHuman(false);
    setResult(DEMOS.find((d) => d.id === id)); setTab("temporal");
    scrollTo("results-anchor");
  };
  const verify = (mode, payload) => setPending({ mode, payload });
  const retry = () => lastRun.current && execute(lastRun.current.mode, lastRun.current.payload);
  const pick = (id) => {
    if (result) { setTab(id); scrollTo("results-anchor"); }
    else { setHeroTab(HERO_TAB[id]); scrollTo("home"); }   // no result yet: open the matching input in the hero form
  };

  return (
    <div className="min-h-screen">
      <Header user={user} onAuth={() => setAuthOpen(true)} onSignOut={logout} health={health} />
      <Hero tab={heroTab} setTab={setHeroTab} onVerify={verify} loading={loading} activeId={result?.id} onDemo={demo} demos={DEMO_CHIPS} />
      <Flow onPick={pick} active={result ? tab : null} />
      <div id="results-anchor" className="px-4 max-w-4xl mx-auto pb-16 scroll-mt-24">
        {loading && <Loading mode={loadingMode} />}
        {error && !loading && <ErrorCard error={error} onRetry={lastRun.current ? retry : null} onDismiss={() => setError(null)} />}
        {result && !loading && <Results r={result} tab={tab} setTab={setTab} human={human} />}
      </div>
      <Extras health={health} />
      {authOpen && <AuthModal onClose={() => setAuthOpen(false)} onLogin={login} />}
      {pending && <CaptchaModal onClose={() => setPending(null)} onDone={() => { const p = pending; setPending(null); setHuman(true); execute(p.mode, p.payload); }} />}
      <footer className="text-center text-xs text-slate-600 pb-10">Satya.ai · Explainable multimodal verification</footer>
    </div>
  );
}
