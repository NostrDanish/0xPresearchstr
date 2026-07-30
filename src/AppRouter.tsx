import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ScrollToTop } from "./components/ScrollToTop";

import Index from "./pages/Index";
import Policy from "./pages/Policy";
import About from "./pages/About";
import Settings from "./pages/Settings";
import Explore from "./pages/Explore";
import { NIP19Page } from "./pages/NIP19Page";
import NotFound from "./pages/NotFound";

export function AppRouter() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Index />} />
        <Route path="/policy" element={<Policy />} />
        <Route path="/about" element={<About />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/explore" element={<Explore />} />
        {/* Legacy: instance management moved into Settings */}
        <Route path="/instances" element={<Navigate to="/settings" replace />} />
        {/* NIP-19 route for npub1, note1, naddr1, nevent1, nprofile1 */}
        <Route path="/:nip19" element={<NIP19Page />} />
        {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
export default AppRouter;
