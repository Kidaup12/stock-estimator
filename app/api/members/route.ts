import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { requireTenantOrResponse } from "@/lib/auth/route-wrapper";

/**
 * Shop user management (Settings → Users).
 *  GET    — list members with emails (any member can see the team).
 *  POST   — add a member by email (OWNER only). Creates the Supabase user if
 *           they don't exist yet; they sign in with the normal 6-digit code.
 *  DELETE — remove a member (OWNER only; not yourself; never the last owner).
 *
 * Membership.userId is the Supabase auth UUID (no FK by design, D-13); emails
 * live in Supabase auth, so we resolve them via the service-role admin client.
 */

function admin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase admin credentials not configured");
  return createAdminClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

export async function GET() {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant, userId } = auth;

  const memberships = await prisma.membership.findMany({
    where: { tenantId: tenant.id },
    orderBy: { createdAt: "asc" },
  });

  const sb = admin();
  const members = await Promise.all(
    memberships.map(async (m) => {
      const { data } = await sb.auth.admin.getUserById(m.userId);
      return {
        id: m.id,
        userId: m.userId,
        email: data?.user?.email ?? "(unknown)",
        role: m.role,
        addedAt: m.createdAt,
        isYou: m.userId === userId,
      };
    })
  );

  return NextResponse.json({ members });
}

const PostBody = z.object({
  email: z.string().email(),
  role: z.enum(["OWNER", "MEMBER"]).default("MEMBER"),
});

export async function POST(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant, membership } = auth;
  if (membership.role !== "OWNER") {
    return NextResponse.json({ error: "Only owners can add users" }, { status: 403 });
  }

  let raw: unknown = {};
  try { raw = await req.json(); } catch { raw = {}; }
  const parsed = PostBody.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
  }
  const email = parsed.data.email.trim().toLowerCase();

  const sb = admin();
  // Find or create the auth user. createUser fails if the email exists; in that
  // case look the user up via listUsers (small instance — fine).
  let uid: string | null = null;
  const created = await sb.auth.admin.createUser({ email, email_confirm: true });
  if (created.data?.user) {
    uid = created.data.user.id;
  } else {
    const list = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    uid = list.data?.users?.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
  }
  if (!uid) return NextResponse.json({ error: "Could not create or find that user" }, { status: 500 });

  const existing = await prisma.membership.findFirst({
    where: { userId: uid, tenantId: tenant.id },
  });
  if (existing) return NextResponse.json({ error: "Already a member of this shop" }, { status: 409 });

  const m = await prisma.membership.create({
    data: { userId: uid, tenantId: tenant.id, role: parsed.data.role },
  });
  return NextResponse.json({ ok: true, member: { id: m.id, email, role: m.role } });
}

const DeleteBody = z.object({ membershipId: z.string().min(1) });

export async function DELETE(req: NextRequest) {
  const auth = await requireTenantOrResponse();
  if (auth instanceof NextResponse) return auth;
  const { tenant, membership, userId } = auth;
  if (membership.role !== "OWNER") {
    return NextResponse.json({ error: "Only owners can remove users" }, { status: 403 });
  }

  let raw: unknown = {};
  try { raw = await req.json(); } catch { raw = {}; }
  const parsed = DeleteBody.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const target = await prisma.membership.findFirst({
    where: { id: parsed.data.membershipId, tenantId: tenant.id },
  });
  if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });
  if (target.userId === userId) {
    return NextResponse.json({ error: "You can't remove yourself" }, { status: 400 });
  }
  if (target.role === "OWNER") {
    const owners = await prisma.membership.count({ where: { tenantId: tenant.id, role: "OWNER" } });
    if (owners <= 1) return NextResponse.json({ error: "A shop needs at least one owner" }, { status: 400 });
  }

  await prisma.membership.delete({ where: { id: target.id } });
  return NextResponse.json({ ok: true });
}
