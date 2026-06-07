import { apiFetch } from "@/lib/api-fetch";

/**
 * Download a tenant-scoped file from an API route. Uses apiFetch (which sends the
 * x-tenant-slug header) + a blob object URL, because window.open can't attach the
 * tenant header. Shared by the Purchase Orders page (PDF/XLSX) and the dashboard
 * reorder CSV export.
 */
export async function downloadFile(slug: string, path: string, filename: string): Promise<void> {
  const res = await apiFetch(slug, path);
  if (!res.ok) {
    alert(`Download failed (${res.status})`);
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
