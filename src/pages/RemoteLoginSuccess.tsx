import { useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useSeoMeta } from "@unhead/react";
import { CheckCircle2, Search } from "lucide-react";

import { Layout } from "@/components/Layout";
import { Button } from "@/components/ui/button";

/**
 * Landing target for the NIP-46 nostrconnect `callback` URL.
 *
 * Mobile flow: the app hands a `nostrconnect://` URI (with
 * `?callback=<origin>/remoteloginsuccess`) to the OS, the signer app
 * (Amber, nsec.app, …) approves, then deep-links the browser back here.
 *
 * The actual handshake completes over the relays — this page is just the
 * friendly "you can go back now" screen. The login itself is persisted in
 * localStorage (origin-shared), so navigating home loads the account.
 */
const RemoteLoginSuccess = () => {
  const navigate = useNavigate();

  useSeoMeta({
    title: "Login Successful",
    description: "Your remote signer approved the connection. You are now logged in.",
    robots: "noindex",
  });

  // Auto-return to the app — the login is already persisted, so the home
  // page comes up logged in. Users on slow devices can use the button.
  useEffect(() => {
    const timer = setTimeout(() => navigate("/", { replace: true }), 2500);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <Layout>
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-4">
        <div className="text-center">
          <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
          <h1 className="text-2xl font-semibold mb-2">Login Successful</h1>
          <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
            Your signer approved the connection. Taking you back to search…
          </p>
          <Button asChild>
            <Link to="/">
              <Search className="w-4 h-4 mr-1.5" />
              Back to Search
            </Link>
          </Button>
        </div>
      </div>
    </Layout>
  );
};

export default RemoteLoginSuccess;
