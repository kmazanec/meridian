import Link from "next/link";
import { faqSections } from "./faqContent";
import { Button } from "@/components/ui";
import { MeridianMark } from "@/components/Logo";

/**
 * The FAQ page. A plain, skimmable explainer for newcomers: an intro, then grouped
 * question/answer sections built from {@link faqSections}. No accordions or search —
 * everything is visible and anchor-linkable, which is simpler and more readable.
 *
 * Presentational and static: it takes only the network label (so the "real money?"
 * answer stays accurate) and renders without the wallet provider, which keeps it
 * trivially testable.
 */
export function FaqView({ clusterLabel }: { clusterLabel: string }) {
  const sections = faqSections(clusterLabel);

  return (
    <div className="space-y-12 py-8" data-testid="faq-view">
      {/* Intro */}
      <section className="text-center">
        <MeridianMark size={40} className="mx-auto mb-5" />
        <div className="text-xs uppercase tracking-widest text-accent">
          New to this? Start here
        </div>
        <h1 className="mt-3 font-serif text-4xl leading-[1.1] tracking-tight text-fg sm:text-5xl">
          How Meridian works
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-fg-dim">
          Take a side on where a stock closes today. No jargon required — here
          are the questions most people have before their first trade.
        </p>
      </section>

      {/* Q&A sections */}
      <div className="space-y-10">
        {sections.map((section) => (
          <section key={section.title}>
            <h2 className="mb-4 font-serif text-2xl tracking-tight text-fg">
              {section.title}
            </h2>
            <div className="space-y-4">
              {section.items.map((item) => (
                <div
                  key={item.id}
                  id={item.id}
                  className="panel scroll-mt-24 p-5"
                >
                  <h3 className="font-serif text-lg text-fg">{item.q}</h3>
                  <div className="mt-2 text-sm leading-relaxed text-fg-dim">
                    {item.a}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Closing CTA */}
      <section className="panel flex flex-col items-center gap-4 p-8 text-center">
        <h2 className="font-serif text-2xl tracking-tight text-fg">
          Ready to take a side?
        </h2>
        <p className="max-w-xl text-sm text-fg-dim">
          Browse today's markets and place your first trade — you can always
          sell out before the close.
        </p>
        <Link href="/markets">
          <Button variant="accent">Browse markets</Button>
        </Link>
      </section>
    </div>
  );
}
