import { Metadata } from "next";
import TutorialView from "./TutorialView";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5001";
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://showmehow.ai";

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

  const stepsText = (tutorial.steps || []).map((s: any) => s.title).slice(0, 5).join(", ");
  const description = `Video tutorial: ${tutorial.title}. ${tutorial.steps?.length || 0} steps with real screenshots and AI narration. Learn: ${stepsText}.`;
  const thumbnail = tutorial.sessionId ? `${API}/output/sessions/${tutorial.sessionId}/images/step-01.png` : undefined;
  const videoUrl = tutorial.sessionId ? `${API}/output/sessions/${tutorial.sessionId}/videos/final-video.mp4` : undefined;

  return {
    title: `${tutorial.title} — Step-by-Step Video Tutorial | ShowMeHow.ai`,
    description,
    alternates: {
      canonical: `${SITE_URL}/tutorial/${slug}`,
    },
    openGraph: {
      title: `${tutorial.title} — Video Tutorial`,
      description,
      type: "article",
      url: `${SITE_URL}/tutorial/${slug}`,
      siteName: "ShowMeHow.ai",
      images: thumbnail ? [{ url: thumbnail, width: 1280, height: 720, alt: tutorial.title }] : [],
      ...(videoUrl ? { videos: [{ url: videoUrl, type: "video/mp4", width: 1280, height: 720 }] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: `${tutorial.title} — Video Tutorial`,
      description,
      images: thumbnail ? [thumbnail] : [],
    },
    keywords: [
      tutorial.topic, `${tutorial.topic} tutorial`, `how to ${tutorial.topic}`,
      tutorial.category, ...(tutorial.tags || []),
      "video tutorial", "step by step", "AI tutorial", "screen recording", "ShowMeHow",
    ],
    robots: { index: true, follow: true },
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

  const thumbnail = tutorial.sessionId ? `${API}/output/sessions/${tutorial.sessionId}/images/step-01.png` : undefined;
  const videoUrl = tutorial.sessionId ? `${API}/output/sessions/${tutorial.sessionId}/videos/final-video.mp4` : undefined;

  // JSON-LD: HowTo structured data for SEO
  const howToLd = {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: tutorial.title,
    description: `Learn ${tutorial.title} step by step with real screenshots and AI narration`,
    image: thumbnail,
    totalTime: tutorial.steps?.length ? `PT${tutorial.steps.length * 2}M` : undefined,
    step: (tutorial.steps || []).map((s: any) => ({
      "@type": "HowToStep",
      name: s.title,
      text: s.description,
      position: s.step,
      image: s.screenshot && tutorial.sessionId ? `${API}/output/sessions/${tutorial.sessionId}/images/${s.screenshot}` : undefined,
      url: `${SITE_URL}/tutorial/${tutorial.slug}#step-${s.step}`,
    })),
    author: { "@type": "Person", name: tutorial.author?.name || "ShowMeHow.ai" },
    publisher: { "@type": "Organization", name: "ShowMeHow.ai", url: SITE_URL },
    datePublished: tutorial.createdAt,
  };

  // JSON-LD: VideoObject for Google Video search results
  const videoLd = videoUrl ? {
    "@context": "https://schema.org",
    "@type": "VideoObject",
    name: tutorial.title,
    description: `Step-by-step video tutorial: ${tutorial.title}. ${tutorial.steps?.length || 0} steps with real screenshots.`,
    thumbnailUrl: thumbnail,
    contentUrl: videoUrl,
    uploadDate: tutorial.createdAt,
    duration: tutorial.steps?.length ? `PT${tutorial.steps.length * 2}M` : undefined,
    author: { "@type": "Person", name: tutorial.author?.name || "ShowMeHow.ai" },
    publisher: { "@type": "Organization", name: "ShowMeHow.ai", url: SITE_URL },
    interactionStatistic: [
      { "@type": "InteractionCounter", interactionType: "https://schema.org/WatchAction", userInteractionCount: tutorial.views || 0 },
      { "@type": "InteractionCounter", interactionType: "https://schema.org/LikeAction", userInteractionCount: tutorial.likes || 0 },
    ],
  } : null;

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(howToLd) }} />
      {videoLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(videoLd) }} />}
      <TutorialView tutorial={tutorial} api={API} />
    </>
  );
}
