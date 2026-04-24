import Dashboard from "./Dashboard";
import { isAuthed } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  if (!(await isAuthed())) redirect("/login");
  return <Dashboard />;
}
