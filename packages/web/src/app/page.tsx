import Link from "next/link";
import { Button } from "@/components/ui";

// Placeholder home; the full Landing experience is built in a later chunk.
export default function HomePage() {
  return (
    <section className="py-16 text-center">
      <h1 className="font-serif text-4xl text-fg">Meridian</h1>
      <p className="mt-3 text-fg-dim">
        One book. Four actions. Two perspectives.
      </p>
      <div className="mt-8">
        <Link href="/markets">
          <Button variant="accent">View markets</Button>
        </Link>
      </div>
    </section>
  );
}
