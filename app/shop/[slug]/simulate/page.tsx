import { redirect } from "next/navigation";

/** Old URL — the Simulate page became the Restock Planner. */
export default async function SimulateRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/shop/${slug}/restock-planner`);
}
