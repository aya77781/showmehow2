import Link from "next/link";

export default function Landing() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-950">
      {/* Navbar */}
      <nav className="flex items-center justify-between px-8 py-5 max-w-7xl mx-auto">
        <span className="text-2xl font-bold text-white tracking-tight">
          ShowMe<span className="text-indigo-400">AI</span>
        </span>
        <div className="flex gap-4">
          <Link
            href="/login"
            className="px-5 py-2 text-white border border-white/20 rounded-lg hover:bg-white/10 transition"
          >
            Sign In
          </Link>
          <Link
            href="/login?tab=register"
            className="px-5 py-2 bg-indigo-500 text-white font-semibold rounded-lg hover:bg-indigo-400 transition"
          >
            Sign Up
          </Link>
        </div>
      </nav>

      {/* Hero */}
      <main className="flex flex-col items-center justify-center text-center px-6 pt-20 pb-28 max-w-5xl mx-auto">
        <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-indigo-500/10 border border-indigo-500/20 rounded-full text-indigo-300 text-sm mb-8">
          <span className="w-2 h-2 bg-green-400 rounded-full animate-pulse" />
          Generate tutorials in under 2 minutes
        </div>
        <h1 className="text-5xl md:text-7xl font-extrabold text-white leading-tight">
          Learn anything with{" "}
          <span className="bg-gradient-to-r from-indigo-400 to-cyan-400 bg-clip-text text-transparent">
            AI video tutorials
          </span>
        </h1>
        <p className="mt-6 text-lg md:text-xl text-slate-400 max-w-2xl">
          Type a topic and get a personalized video tutorial, narrated by your
          own AI avatar, with real UI screenshots. In under 2 minutes.
        </p>
        <div className="mt-10 flex gap-4">
          <Link
            href="/login?tab=register"
            className="px-8 py-3.5 bg-indigo-500 text-white font-bold rounded-xl text-lg hover:bg-indigo-400 transition shadow-lg shadow-indigo-500/25"
          >
            Get Started Free
          </Link>
          <a
            href="#how"
            className="px-8 py-3.5 border border-white/20 text-white font-semibold rounded-xl text-lg hover:bg-white/5 transition"
          >
            How it works
          </a>
        </div>

        {/* Demo mockup */}
        <div className="mt-16 w-full max-w-3xl bg-slate-900/50 border border-white/10 rounded-2xl p-6 backdrop-blur">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-3 h-3 rounded-full bg-red-500/60" />
            <div className="w-3 h-3 rounded-full bg-yellow-500/60" />
            <div className="w-3 h-3 rounded-full bg-green-500/60" />
          </div>
          <div className="bg-slate-800/50 rounded-xl p-8 text-left">
            <p className="text-slate-500 text-sm mb-2">Type your topic...</p>
            <p className="text-white text-xl font-medium">
              &quot;How to deploy a Next.js app to Vercel&quot;
            </p>
            <div className="mt-6 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-indigo-500/20 flex items-center justify-center">
                <span className="text-indigo-400">▶</span>
              </div>
              <div className="flex-1">
                <div className="h-2 bg-indigo-500/30 rounded-full">
                  <div className="h-2 bg-indigo-400 rounded-full w-2/3" />
                </div>
              </div>
              <span className="text-slate-500 text-sm">1:42</span>
            </div>
          </div>
        </div>
      </main>

      {/* How it works */}
      <section id="how" className="py-20 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-4">
            How it works
          </h2>
          <p className="text-slate-400 text-center mb-16 max-w-xl mx-auto">
            From question to video tutorial in 4 automatic steps
          </p>
          <div className="grid md:grid-cols-4 gap-8">
            {[
              {
                step: "1",
                title: "Type your topic",
                desc: "Describe what you want to learn in plain language.",
              },
              {
                step: "2",
                title: "AI researches",
                desc: "Our agent fetches context and navigates the real UI with Playwright.",
              },
              {
                step: "3",
                title: "Claude maps the steps",
                desc: "Analyzes each screenshot and generates step-by-step narration.",
              },
              {
                step: "4",
                title: "Video with your avatar",
                desc: "A personalized video is rendered, narrated by your AI avatar.",
              },
            ].map((s, i) => (
              <div key={i} className="text-center">
                <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-bold text-lg">
                  {s.step}
                </div>
                <h3 className="text-lg font-bold text-white mb-2">
                  {s.title}
                </h3>
                <p className="text-slate-400 text-sm">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 border-t border-white/5">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-16">
            Why ShowMe AI
          </h2>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              {
                icon: "🎬",
                title: "Video, not text",
                desc: "Learn by watching, not reading. Real UI screenshots with step-by-step narration.",
              },
              {
                icon: "🧑‍💻",
                title: "Your own avatar",
                desc: "A personalized AI avatar narrates every tutorial. Like having a private tutor.",
              },
              {
                icon: "⚡",
                title: "Ready in 2 min",
                desc: "Stop searching YouTube. Generate a tutorial specific to your case instantly.",
              },
              {
                icon: "🌍",
                title: "Multilingual",
                desc: "Tutorials in English, Spanish, Portuguese and more. Localized content.",
              },
              {
                icon: "📚",
                title: "Your library",
                desc: "Save and organize all your tutorials. Access them anytime.",
              },
              {
                icon: "🔗",
                title: "Share",
                desc: "Publish tutorials and share knowledge with your team or community.",
              },
            ].map((f, i) => (
              <div
                key={i}
                className="bg-white/5 border border-white/10 rounded-2xl p-6 hover:bg-white/[0.07] transition"
              >
                <div className="text-4xl mb-3">{f.icon}</div>
                <h3 className="text-lg font-bold text-white mb-2">
                  {f.title}
                </h3>
                <p className="text-slate-400 text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-20 px-6 border-t border-white/5">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl md:text-4xl font-bold text-white text-center mb-16">
            Pricing
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                name: "Free",
                price: "0",
                features: [
                  "5 tutorials/month",
                  "Basic avatar",
                  "Public library",
                ],
                cta: "Get Started",
                highlight: false,
              },
              {
                name: "Pro",
                price: "12",
                features: [
                  "Unlimited tutorials",
                  "Premium avatar",
                  "Multilingual",
                  "PDF export",
                  "Private library",
                ],
                cta: "Choose Pro",
                highlight: true,
              },
              {
                name: "Power",
                price: "29",
                features: [
                  "Everything in Pro",
                  "Team sharing",
                  "Analytics",
                  "Custom avatar voice",
                  "Priority rendering",
                ],
                cta: "Choose Power",
                highlight: false,
              },
            ].map((plan, i) => (
              <div
                key={i}
                className={`rounded-2xl p-6 ${
                  plan.highlight
                    ? "bg-indigo-500 text-white ring-2 ring-indigo-400"
                    : "bg-white/5 border border-white/10 text-white"
                }`}
              >
                <h3 className="text-lg font-bold mb-1">{plan.name}</h3>
                <p className="text-3xl font-extrabold mb-4">
                  €{plan.price}
                  <span className="text-sm font-normal opacity-70">/mo</span>
                </p>
                <ul className="space-y-2 mb-6">
                  {plan.features.map((f, j) => (
                    <li key={j} className="text-sm flex items-center gap-2">
                      <span
                        className={
                          plan.highlight ? "text-white" : "text-indigo-400"
                        }
                      >
                        ✓
                      </span>
                      <span
                        className={
                          plan.highlight ? "text-indigo-100" : "text-slate-300"
                        }
                      >
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/login?tab=register"
                  className={`block text-center py-2.5 rounded-xl font-semibold transition ${
                    plan.highlight
                      ? "bg-white text-indigo-600 hover:bg-indigo-50"
                      : "bg-white/10 hover:bg-white/15"
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 px-6 border-t border-white/5">
        <div className="max-w-2xl mx-auto text-center">
          <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">
            Stop searching. Start learning.
          </h2>
          <p className="text-slate-400 mb-8">
            Generate your first tutorial in under 2 minutes. Free.
          </p>
          <Link
            href="/login?tab=register"
            className="inline-block px-8 py-3.5 bg-indigo-500 text-white font-bold rounded-xl text-lg hover:bg-indigo-400 transition shadow-lg shadow-indigo-500/25"
          >
            Create free account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 text-slate-500 text-center py-8 text-sm">
        <p>&copy; 2026 ShowMe AI — Built at AMS GenAI & Video Hackathon</p>
      </footer>
    </div>
  );
}
