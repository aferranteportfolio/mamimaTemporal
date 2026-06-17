import { useMemo, useState, useEffect } from "react";
import {
  saveProgrammedMessage,
  listProgrammedMessages,
  getProgrammedMessage,
  queueProgrammedMessageTest,
  listProductTags
} from "../api/realApi.js";

// --- helpers (pure) ---
function to12h(hhmm = "15:00") {
  const [h, m] = hhmm.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}
function nextHour(existing = []) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  now.setHours(now.getHours() + 1);
  for (let i = 0; i < 24; i++) {
    const hh = String((now.getHours() + i) % 24).padStart(2, "0");
    const cand = `${hh}:00`;
    if (!existing.includes(cand)) return cand;
  }
  return "00:00";
}

export default function ProgrammedMessagesPage() {
  // ====== saving / editing ids ======
  const [saving, setSaving] = useState(false);
  const [currentId, setCurrentId] = useState(null); // server id once created

  // ====== SERVER LIST (left column) ======
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);
  const [productTagOptions, setProductTagOptions] = useState([]);
  const [tagErr, setTagErr] = useState(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        // Try server first
        const { items } = await listProgrammedMessages();
        if (dead) return;

        if (Array.isArray(items) && items.length) {
          setList(items.map(x => ({ id: x.id, title: x.title || "(sin título)" })));
        } else {
          // fallback seeds for first run
          const seed = [
            { id: "p1", title: "POST SHAPPER" },
            { id: "p2", title: "ENVIO SHALOM" },
            { id: "p3", title: "CONTRA 10" },
            { id: "p4", title: "CONFIRMACION ENVIO PROVINCIA" },
          ];
          setList(seed);
        }
      } catch (e) {
        console.warn("[PM] list failed; using seeds:", e);
        const seed = [
          { id: "p1", title: "POST SHAPPER" },
          { id: "p2", title: "ENVIO SHALOM" },
          { id: "p3", title: "CONTRA 10" },
          { id: "p4", title: "CONFIRMACION ENVIO PROVINCIA" },
        ];
        setList(seed);
        setErr(e.message || String(e));
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const { items } = await listProductTags();
        if (!dead) setProductTagOptions(Array.isArray(items) ? items : []);
      } catch (e) {
        console.warn("[PM] product tags failed:", e);
        if (!dead) setTagErr(e.message || String(e));
      }
    })();
    return () => { dead = true; };
  }, []);

  // ====== LOCAL UI STATE ======
  const [q, setQ] = useState("");
  const [activeId, setActiveId] = useState(null);
  const [menuOpenId, setMenuOpenId] = useState(null);
  const [activeLoading, setActiveLoading] = useState(false);

  useEffect(() => {
    if (!list.length) return;
    if (!activeId) setActiveId(list[0].id);
  }, [list, activeId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return !s ? list : list.filter(x => (x.title || "").toLowerCase().includes(s));
  }, [list, q]);

  const active = useMemo(
    () => filtered.find(x => x.id === activeId) || filtered[0],
    [filtered, activeId]
  );

  // ====== MESSAGE CONFIG (center column) ======
  const [title, setTitle] = useState("POST SHAPPER");
  const [parts, setParts] = useState([
    "",
    "",
    "",
    "──────\nTallas : M, L, XL y XXL\n\nMaterial : Algodón, Spandex y Poliéster",
    "🍊 *PRECIO FAJA SOLA: S/. 89*\n🍋 *EN PACK CREMA CON FAJA: S/. 119*",
    "*Dónde se ubica?*",
  ]);

  // Load selected item's meta
  useEffect(() => {
    if (!active) return;

    const looksSeed = /^p\d+$/.test(active.id) || /^new-/.test(active.id);
    setActiveLoading(true);

    (async () => {
      try {
        if (looksSeed) {
          // fresh slate for seeds/new
          setCurrentId(null);
          setTitle(active.title || "Nuevo Programado");
          setParts([""]);
          setFunnel({ level1:false, level2:false, level3:false, level4:false });
          setPreset("custom");
          setDelayHours(12);
          setSlots([]);
          setSelectedProductTags([]);
          setTestPhoneNumber("");
          setTestStatus(null);
          return;
        }

        // real item → fetch meta.json from server
        const meta = await getProgrammedMessage(active.id);

        setCurrentId(meta.id);
        setTitle(meta.title || "Sin título");

        const msgs = Array.isArray(meta.messages) ? meta.messages : [];
        setParts(msgs.length ? msgs.map(m => m?.text || "") : [""]);

        const mm = meta.misc || {};
        setFunnel({
          level1: !!mm.funnelLevel1,
          level2: !!mm.funnelLevel2,
          level3: !!mm.funnelLevel3,
          level4: !!mm.funnelLevel4,
        });

        const sch = meta.schedule || {};
        setPreset(sch.preset || "custom");
        setDelayHours(Number(sch.delayHours) || 23.5);
        setSlots(Array.isArray(sch.times) ? sch.times : []);
        setSelectedProductTags(Array.isArray(meta.targeting?.productTags) ? meta.targeting.productTags : []);
        setTestPhoneNumber(meta.testing?.phoneNumber || "");
      } catch (e) {
        console.error("[PM] load active failed:", e);
        setCurrentId(null);
        setTitle(active.title || "Nuevo Programado");
        setParts([""]);
        setFunnel({ level1:false, level2:false, level3:false, level4:false });
        setPreset("custom");
        setDelayHours(12);
        setSlots([]);
        setSelectedProductTags([]);
        setTestPhoneNumber("");
        setTestStatus(null);
      } finally {
        setActiveLoading(false);
      }
    })();
  }, [active]);

  const updatePart = (i, val) =>
    setParts(prev => prev.map((p, idx) => (idx === i ? val : p)));

  // ====== MISC CONFIG (third column) ======
  const [funnel, setFunnel] = useState({
    level1: false, // Producto
    level2: false, // Envío
    level3: false, // Cuenta
    level4: false, // Post compra
  });

  // ====== 24H HOURS (fourth column) ======
  const [preset, setPreset] = useState("custom");
  const [delayHours, setDelayHours] = useState(12);
  const [slots, setSlots] = useState(["15:00", "16:00", "17:00"]);
  const [selectedProductTags, setSelectedProductTags] = useState([]);
  const [testPhoneNumber, setTestPhoneNumber] = useState("");
  const [testStatus, setTestStatus] = useState(null);
  const addSlot = (hhmm) => setSlots(s => (s.includes(hhmm) ? s : [...s, hhmm].sort()));
  const removeSlot = (hhmm) => setSlots(s => s.filter(x => x !== hhmm));

  // ====== DERIVED PAYLOAD PIECES ======
  const contentsList = useMemo(
    () => parts.map(p => ({ text: p || "", files: [], delayMs: 0 })),
    [parts]
  );
  const flags = useMemo(
    () => ({
      f1: !!funnel.level1,
      f2: !!funnel.level2,
      f3: !!funnel.level3,
      f4: !!funnel.level4,
    }),
    [funnel]
  );
  const schedulePreset = preset;
  const orderedTimes = useMemo(() => [...slots].sort(), [slots]);
  const normalizedDelayHours = Number(delayHours) > 0 ? Number(delayHours) : 12;
  const toggleProductTag = (tag) => {
    setSelectedProductTags(prev => prev.includes(tag)
      ? prev.filter(x => x !== tag)
      : [...prev, tag].sort());
  };

  // ====== ACTIONS ======
  const onAdd = () => {
    const phantom = { id: `new-${Date.now()}`, title: "Nuevo Programado" };
    setList(prev => [phantom, ...prev]);
    setActiveId(phantom.id);
    setCurrentId(null);
    setTitle("Nuevo Programado");
    setParts([""]);
    setFunnel({ level1: false, level2: false, level3: false, level4: false });
    setDelayHours(12);
    setSlots([]);
    setSelectedProductTags([]);
    setTestPhoneNumber("");
  };

  const onDelete = async (id) => {
    setMenuOpenId(null);
    setList(prev => prev.filter(x => x.id !== id));
    if (activeId === id) setActiveId(null);
  };

  const onSave = async () => {
    try {
      setSaving(true);

      const payload = {
        id: currentId || undefined,                 // POST if null, PUT if present
        title,
        messages: contentsList,                     // [{ text, files, delayMs }]
        misc: {
          funnelLevel1: flags.f1,
          funnelLevel2: flags.f2,
          funnelLevel3: flags.f3,
          funnelLevel4: flags.f4,
        },
        schedule: {
          mode: "delayAfterInbound",
          delayHours: normalizedDelayHours,
          preset: schedulePreset,
          times: orderedTimes,
        },
        targeting: { productTags: selectedProductTags },
        testing: { phoneNumber: testPhoneNumber },
      };

      const saved = await saveProgrammedMessage(payload);
      setCurrentId(saved.id);

      // reflect in the left list and keep selection
      setList(prev => {
        const rest = prev.filter(x => x.id !== saved.id && x.id !== activeId);
        return [{ id: saved.id, title: saved.title }, ...rest];
      });
      setActiveId(saved.id);

      console.log("Guardado ✅", saved);
    } catch (e) {
      console.error("No se pudo guardar", e);
    } finally {
      setSaving(false);
    }
  };

  const onQueueTest = async () => {
    const phone = String(testPhoneNumber || "").replace(/\D/g, "");
    if (!phone) {
      setTestStatus({ type: "error", text: "Enter a WhatsApp test number first." });
      return;
    }

    try {
      setSaving(true);
      setTestStatus(null);

      // Always save first so the dispatcher tests exactly what is currently in
      // the config screen: message text, funnel, tags, delay metadata, and the
      // manually-entered test phone number.
      const saved = await saveProgrammedMessage({
        id: currentId || undefined,
        title,
        messages: contentsList,
        misc: {
          funnelLevel1: flags.f1,
          funnelLevel2: flags.f2,
          funnelLevel3: flags.f3,
          funnelLevel4: flags.f4,
        },
        schedule: {
          mode: "delayAfterInbound",
          delayHours: normalizedDelayHours,
          preset: schedulePreset,
          times: orderedTimes,
        },
        targeting: { productTags: selectedProductTags },
        testing: { phoneNumber: phone },
      });

      setCurrentId(saved.id);
      setActiveId(saved.id);
      setList(prev => [{ id: saved.id, title: saved.title }, ...prev.filter(x => x.id !== saved.id && x.id !== activeId)]);

      const queued = await queueProgrammedMessageTest(saved.id, { phoneNumber: phone });
      setTestStatus({
        type: "ok",
        text: `Test queued for ${queued.customer_id}. It is due now; run the PM dispatcher or wait for the next loop tick.`,
      });
    } catch (e) {
      console.error("No se pudo encolar prueba", e);
      setTestStatus({ type: "error", text: e.message || String(e) });
    } finally {
      setSaving(false);
    }
  };

  // ====== RENDER ======
  return (
    <div className="sr-page">
      {/* COLUMN 1: LEFT LIST */}
      <aside className="sr-col sr-col-list">
        <div className="sr-col-header">
          <div className="sr-col-title">MESSAGES</div>

          <div className="sr-searchbar">
            <input
              className="sr-search-input"
              placeholder="SEARCH BAR"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>

          <div className="sr-add-wrap">
            <button type="button" className="sr-add-btn" onClick={onAdd}>
              Add
            </button>
          </div>
        </div>

        <ul className="sr-list-items">
          {loading && <li className="sr-empty">Cargando…</li>}
          {err && !loading && <li className="sr-empty">Error: {err}</li>}
          {!loading && !err && filtered.length === 0 && (
            <li className="sr-empty">Sin resultados</li>
          )}

          {!loading && !err && filtered.map(item => (
            <li
              key={item.id}
              className={"sr-list-item" + (activeId === item.id ? " active" : "")}
            >
              <button className="sr-list-main" onClick={() => setActiveId(item.id)}>
                {item.title}
              </button>

              <div className="sr-li-kebab" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="sr-kebab-btn"
                  aria-haspopup="menu"
                  aria-expanded={menuOpenId === item.id}
                  onClick={() => setMenuOpenId(cur => (cur === item.id ? null : item.id))}
                >
                  ⋯
                </button>

                {menuOpenId === item.id && (
                  <div className="sr-li-menu" role="menu">
                    <button className="sr-li-menu-btn" onClick={() => setActiveId(item.id)}>
                      Edit
                    </button>
                    <button className="sr-li-menu-btn danger" onClick={() => onDelete(item.id)}>
                      Delete
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
      </aside>

      {/* COLUMN 2: MESSAGE CONFIGURATION */}
      <section className="sr-col sr-col-config">
        <div className="sr-col-header">
          <div className="sr-col-title">MESSAGE CONFIGURATION</div>
          <div className="sr-col-subtitle">
            {activeLoading ? "Loading…" : "(WE ALREADY HAVE THIS, IS THE SAVED REPLY MODAL)"}
          </div>
        </div>

        <form className="sr-form" onSubmit={(e) => { e.preventDefault(); onSave(); }}>
          <div className="sr-field">
            <label className="sr-label">Título</label>
            <div className="sr-pill">
              <input
                className="sr-pill-input"
                placeholder="Ej. POST SHAPPER"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>
          </div>

          {parts.map((val, i) => (
            <div className="sr-field" key={i}>
              <label className="sr-label">Contenido{i + 1}</label>
              <div className="sr-textarea-wrap sr-card">
                <textarea
                  className="sr-textarea"
                  placeholder="Escribe el mensaje…"
                  value={val}
                  onChange={(e) => updatePart(i, e.target.value)}
                />
                <span className="sr-counter">{val.length}</span>
              </div>
            </div>
          ))}

          <div className="sr-actions-right">
            <button type="button" className="sr-btn ghost" disabled={saving}>Cancelar</button>
            <button type="submit" className="sr-btn primary" disabled={saving}>
              {saving ? "Guardando…" : "Guardar"}
            </button>
          </div>
        </form>
      </section>

      {/* COLUMN 3: MISC CONFIG (funnel flags) */}
      <section className="sr-col sr-col-triggers">
        <div className="sr-col-header">
          <div className="sr-col-title">MISC CONFIG</div>
          <div className="sr-col-subtitle">&nbsp;</div>
        </div>

        <div className="sr-triggers-body">
          {[
            ["level1","FUNNEL LEVEL 1 PRODUCTO"],
            ["level2","FUNNEL LEVEL 2 ENVÍO"],
            ["level3","FUNNEL LEVEL 3 CUENTA"],
            ["level4","FUNNEL LEVEL 4 POST COMPRA"],
          ].map(([key,label])=>(
            <label key={key} className="sr-misc-check">
              <input
                type="checkbox"
                checked={!!funnel[key]}
                onChange={e => setFunnel(s => ({ ...s, [key]: e.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}

          <div className="sr-trigger-savewrap">
            <button type="button" className="sr-btn sr-btn-primary" onClick={onSave} disabled={saving}>
              SAVE
            </button>
          </div>
        </div>
      </section>

      {/* COLUMN 4: MESSAGES WITHIN 24 HOURS */}
      <aside className="sr-col sr-col-misc">
        <div className="sr-col-header">
          <div className="sr-col-title">MESSAGES WITHIN 24 HOURS</div>
          <div className="sr-col-subtitle">&nbsp;</div>
        </div>

        <div className="sr-misc-body">
          <div className="sr-card" style={{ padding: 12, marginBottom: 12 }}>
            <label className="sr-label">Send after customer inactivity</label>
            <select
              className="sr-select"
              value={String(delayHours)}
              onChange={e => setDelayHours(e.target.value === "custom" ? delayHours : Number(e.target.value))}
            >
              <option value="2">2 hours after last customer message</option>
              <option value="4">4 hours after last customer message</option>
              <option value="6">6 hours after last customer message</option>
              <option value="12">12 hours after last customer message</option>
              <option value="18">18 hours after last customer message</option>
              <option value="23.5">23.5 hours / near 24h</option>
            </select>
            <input
              className="sr-pill-input"
              type="number"
              min="0.25"
              max="23.5"
              step="0.25"
              value={delayHours}
              onChange={e => setDelayHours(e.target.value)}
              aria-label="Custom delay hours after customer message"
              style={{ marginTop: 8 }}
            />
          </div>

          <div className="sr-card" style={{ padding: 12, marginBottom: 12 }}>
            <label className="sr-label">Product tag targeting</label>
            {tagErr && <div className="sr-empty">Tags unavailable: {tagErr}</div>}
            {!tagErr && productTagOptions.length === 0 && (
              <div className="sr-empty">No product tags found; all products will match.</div>
            )}
            <div style={{ display: "grid", gap: 6, maxHeight: 140, overflow: "auto" }}>
              {productTagOptions.map(tag => (
                <label key={tag.value} className="sr-misc-check">
                  <input
                    type="checkbox"
                    checked={selectedProductTags.includes(tag.value)}
                    onChange={() => toggleProductTag(tag.value)}
                  />
                  <span>{tag.label || tag.value}</span>
                </label>
              ))}
            </div>
            <p className="sr-note">
              {selectedProductTags.length
                ? `Selected: ${selectedProductTags.join(", ")}`
                : "No tags selected: all products/tags are eligible."}
            </p>
          </div>

          <div style={{ marginBottom: 10 }}>
            <div className="sr-col-subtitle" style={{ textAlign: "center" }}>LEGACY TIME PRESETS</div>
            <select
              className="sr-select"
              value={preset}
              onChange={e => {
                const v = e.target.value; setPreset(v);
                if (v === "morning") setSlots(["09:00","10:00","11:00"]);
                else if (v === "afternoon") setSlots(["15:00","16:00","17:00"]);
                else if (v === "evening") setSlots(["19:00"]);
                else setSlots([]);
              }}
            >
              <option value="custom">Custom</option>
              <option value="morning">Morning (9–11)</option>
              <option value="afternoon">Afternoon (15–17)</option>
              <option value="evening">Evening (19 only; backend legacy business hours end at 20:00)</option>
            </select>
          </div>

          <div className="sr-card" style={{ padding: 12 }}>
            <div className="sr-col-title" style={{ fontSize: 14, textAlign: "center", marginBottom: 6 }}>
              ORDERED LIST OF HOURS
            </div>
            <ul className="sr-hours-list">
              {slots.map(t => (
                <li key={t} className="sr-hour-item">
                  <span>{to12h(t)}</span>
                  <button className="sr-li-menu-btn" onClick={() => removeSlot(t)}>remove</button>
                </li>
              ))}
            </ul>

            <div className="sr-hours-add">
              <input
                type="time"
                className="sr-time"
                onChange={e => e.target.value && addSlot(e.target.value)}
              />
              <button className="sr-btn" onClick={() => addSlot(nextHour(slots))}>+1h</button>
            </div>
          </div>

          <div className="sr-card" style={{ padding: 12, marginTop: 12 }}>
            <label className="sr-label">Manual test WhatsApp number</label>
            <input
              className="sr-pill-input"
              placeholder="Ej. 51999999999"
              value={testPhoneNumber}
              onChange={e => setTestPhoneNumber(e.target.value)}
            />
            <button
              type="button"
              className="sr-btn sr-btn-primary"
              style={{ marginTop: 8 }}
              disabled={saving || !testPhoneNumber.trim()}
              onClick={onQueueTest}
            >
              Queue test now
            </button>
            {testStatus && (
              <p className="sr-note" style={{ color: testStatus.type === "error" ? "#b91c1c" : "#166534" }}>
                {testStatus.text}
              </p>
            )}
          </div>

          <p className="sr-note">
            • New messages use the delay above, e.g. 12h after the latest customer message.
            • Queue test now creates a due test task for the typed number without waiting for the configured delay.
            • Legacy hour presets are preserved as metadata; the backend still enforces the 24h safety window.
          </p>
        </div>
      </aside>
    </div>
  );
}
