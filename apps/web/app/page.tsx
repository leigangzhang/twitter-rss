import { RssList } from "@/components/RssList";
import { SubscribeForm } from "@/components/SubscribeForm";
import { config, siteUrl, topicOptions } from "@/lib/server";

export const dynamic = "force-dynamic";

export default function Home() {
  const topics = topicOptions();
  return (
    <main className="flex flex-col gap-12">
      <SubscribeForm topics={topics} defaultLang={config().digest.default_language} />
      <RssList topics={topics} site={siteUrl()} />
    </main>
  );
}
