import Link from "next/link";
import { auth, signIn, signOut } from "@/auth";
import { Button } from "@/components/ui/button";

export async function Header() {
  const session = await auth();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-white shadow-sm">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-1">
          <div className="flex items-center">
            <span className="text-2xl font-bold tracking-tight">
              <span className="text-[#dc3558]">book</span>
              <span className="text-[#1a1a2e]">my</span>
              <span className="text-[#dc3558]">show</span>
            </span>
          </div>
        </Link>

        <nav className="flex items-center gap-6">
          <Link href="/" className="text-sm font-medium text-gray-700 hover:text-[#dc3558] transition-colors">
            Movies
          </Link>
          <Link href="/" className="text-sm font-medium text-gray-700 hover:text-[#dc3558] transition-colors hidden sm:block">
            Events
          </Link>
          <Link href="/" className="text-sm font-medium text-gray-700 hover:text-[#dc3558] transition-colors hidden sm:block">
            Plays
          </Link>

          {session?.user ? (
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-600 hidden md:block">
                Hi, {session.user.name?.split(' ')[0] ?? 'User'}
              </span>
              <form
                action={async () => {
                  "use server";
                  await signOut();
                }}
              >
                <Button variant="outline" size="sm" type="submit" className="border-[#dc3558] text-[#dc3558] hover:bg-[#dc3558] hover:text-white">
                  Sign Out
                </Button>
              </form>
            </div>
          ) : (
            <form
              action={async () => {
                "use server";
                await signIn("google");
              }}
            >
              <Button size="sm" type="submit" className="bg-[#dc3558] hover:bg-[#c42a4a] text-white">
                Sign In
              </Button>
            </form>
          )}
        </nav>
      </div>
    </header>
  );
}
