import { Metadata } from "next";
import TutorialView from "./TutorialView";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";

interface Props { params: Promise<{ slug: string }> }

async function getTutorial(slug: string) {
  const res = await fetch(`${API}/api/explore/${slug}`, { next: { revalidate: 60 } });
  if (!res.ok) return null;
  return res.json();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const tutorial = await getTutorial(slug);
  if (!tutorial) return { title: "Tutorial Not Found" };

  return {
    title: `${tutorial.title} — ShowMe AI Tutorial`,
    description: `Learn ${tutorial.title} step by step with an AI-generated video tutorial. ${tutorial.steps?.length || 0} steps with real screenshots.`,
    openGraph: {
      title: tutorial.title,
      description: `AI video tutorial: ${tutorial.title}`,
      type: "article",
      images: tutorial.sessionId ? [`${API}/output/sessions/${tutorial.sessionId}/images/step-01.png`] : [],
    },
    keywords: [tutorial.topic, tutorial.category, ...(tutorial.tags || []), "tutorial", "AI", "video tutorial"],
  };
}

export default async function TutorialPage({ params }: Props) {
  const { slug } = await params;
  const tutorial = await getTutorial(slug);

  if (!tutorial) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-white mb-2">404</h1>
          <p className="text-slate-400">Tutorial not found</p>
          <a href="/explore" className="mt-4 inline-block text-indigo-400 hover:text-indigo-300 text-sm">Browse tutorials</a>
        </div>
      </div>
    );
  }

  // JSON-LD structured data for SEO
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: tutorial.title,
    description: `Learn ${tutorial.title} step by step`,
    step: (tutorial.steps || []).map((s: any) => ({
      "@type": "HowToStep",
      name: s.title,
      text: s.description,
      position: s.step,
      image: s.screenshot && tutorial.sessionId ? `${API}/output/sessions/${tutorial.sessionId}/images/${s.screenshot}` : undefined,
    })),
    author: { "@type": "Person", name: tutorial.author?.name || "ShowMe AI" },
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <TutorialView tutorial={tutorial} api={API} />
    </>
  );
}
