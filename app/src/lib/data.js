import { supabase } from "./supabase";

// All queries are auto-scoped to the signed-in user's org by RLS — no org_id filtering needed client-side.
// customers = the CRM pipeline (lead/interested/booked + contact). knocks = per-parcel visit outcomes.

// ---------- customers ----------
export async function loadCustomers() {
  const { data, error } = await supabase
    .from("customers")
    .select("*")
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// create or update a customer; returns the saved row. parcelId optional (null for manually-added).
export async function saveCustomer(c) {
  const row = {
    id: c.id,                       // undefined for new -> DB generates
    org_id: c.org_id,               // set by caller from profile.org_id
    parcel_id: c.parcel_id ?? null,
    status: c.status ?? "lead",
    name: c.name ?? null, phone: c.phone ?? null, email: c.email ?? null,
    addr: c.addr ?? null, city: c.city ?? null,
    method: c.method ?? null, place_date: c.place_date || null,
    price: c.price === "" || c.price == null ? null : c.price,
    notes: c.notes ?? null,
    lat: c.lat ?? null, lng: c.lng ?? null,
    updated_at: new Date().toISOString(),
  };
  Object.keys(row).forEach((k) => row[k] === undefined && delete row[k]);
  const { data, error } = await supabase.from("customers").upsert(row).select().single();
  if (error) throw error;
  return data;
}

export async function deleteCustomer(id) {
  const { error } = await supabase.from("customers").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw error;
}

// ---------- knocks ----------
export async function loadKnocks() {
  const { data, error } = await supabase
    .from("knocks")
    .select("*")
    .order("knocked_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function logKnock(k) {
  const row = {
    org_id: k.org_id,
    parcel_id: k.parcel_id,
    outcome: k.outcome,
    notes: k.notes ?? null,
    lat: k.lat ?? null, lng: k.lng ?? null,
  };
  const { data, error } = await supabase.from("knocks").insert(row).select().single();
  if (error) throw error;
  return data;
}

// ---------- realtime ----------
// fire `cb` whenever this org's customers or knocks change (insert/update/delete). returns an unsubscribe fn.
export function subscribeShared(orgId, cb) {
  const ch = supabase
    .channel(`org-${orgId}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "customers", filter: `org_id=eq.${orgId}` }, () => cb("customers"))
    .on("postgres_changes", { event: "*", schema: "public", table: "knocks", filter: `org_id=eq.${orgId}` }, () => cb("knocks"))
    .subscribe();
  return () => supabase.removeChannel(ch);
}
