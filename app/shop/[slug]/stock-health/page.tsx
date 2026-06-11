import { redirect } from "next/navigation";

/** Old URL — Stock health became the Products page. */
export default async function StockHealthRedirect({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(`/shop/${slug}/products`);
}
