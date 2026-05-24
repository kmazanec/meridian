import type { Metadata } from "next";
import { CLUSTER_LABEL } from "@/lib/env";
import { FaqView } from "@/components/faq/FaqView";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "New to Meridian? Plain-language answers to the questions most people have before their first trade — what you're betting on, how prices work, and how markets settle.",
};

// Fully static explainer — no wallet, no chain reads. The cluster label only decides
// whether the "real money?" answer says real or test funds.
export default function FaqPage() {
  return <FaqView clusterLabel={CLUSTER_LABEL} />;
}
