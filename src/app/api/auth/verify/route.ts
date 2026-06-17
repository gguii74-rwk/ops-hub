import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth/federation";

export async function GET() {
  const identity = await verifySession();
  if (!identity) {
    return new NextResponse(null, { status: 401 });
  }
  const res = new NextResponse(null, { status: 200 });
  res.headers.set("X-Auth-Sub", identity.sub);
  res.headers.set("X-Auth-Email", identity.email);
  res.headers.set("X-Auth-Groups", identity.groups.join(","));
  return res;
}
