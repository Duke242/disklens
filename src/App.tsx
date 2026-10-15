import { useEffect, useState } from "react";
import { api, isDemo, type Platform } from "./api";
import { Segmented } from "./components/ui";
import { MemoryTab } from "./memory/MemoryTab";
import { StorageTab } from "./storage/StorageTab";
import { usePalette } from "./theme";
import icon from "../src-tauri/icons/128x128.png";

type Tab = "Storage" | "Memory";

export function App() {
  const [tab, setTab] = useState<Tab>("Storage");
  const [platform, setPlatform] = useState<Platform | null>(null);
  const palette = usePalette();

  useEffect(() => {
    api.platform().then(setPlatform);
  }, []);

  return (
    <div className="app">
      <div className="topbar">
        <div className="brand"><img src={icon} alt="" />DiskLens</div>
        <Segmented options={["Storage", "Memory"] as Tab[]} value={tab} onChange={setTab} />
        <span className="spacer" />
        {isDemo && <span className="demo-badge">Demo data: run inside the app to see your own</span>}
      </div>
      {platform && (
        <>
          <div className="tab" hidden={tab !== "Storage"}>
            <StorageTab platform={platform} palette={palette} />
          </div>
          <MemoryTab visible={tab === "Memory"} palette={palette} />
        </>
      )}
    </div>
  );
}
