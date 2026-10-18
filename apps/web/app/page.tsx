import { RssList } from "@/components/RssList";
import { SubscribeForm } from "@/components/SubscribeForm";
import { config, siteUrl, topicOptions } from "@/lib/server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const topics = await topicOptions();
  return (
    <main className="flex flex-col gap-12">
      <SubscribeForm topics={topics} defaultLang={config().digest.default_language} maxAvatars={config().digest.subscribe_page.max_avatars} />
      <RssList topics={topics} site={siteUrl()} />
    </main>
  );
}
