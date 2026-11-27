import CampaignEditor from "@/components/CampaignEditor";
import { getCampaign } from "@/lib/campaigns";
import { redisConfigured } from "@/lib/redis";

export const dynamic = "force-dynamic";

export default async function Nouvelle({ searchParams }) {
  const sp = await searchParams;
  const initial = sp?.id && redisConfigured ? await getCampaign(sp.id) : null;
  if (initial) delete initial.stats;
  return <CampaignEditor initial={initial} />;
}
