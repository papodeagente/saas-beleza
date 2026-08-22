import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";

export default async function RootPage() {
  redirect((await getSession()) ? "/hoje" : "/entrar");
}
