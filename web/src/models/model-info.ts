import type { Opponent } from "../engine";
import original11 from "./original-1.1/model.md?raw";
import originalPeg12 from "./original_exhaustive_peg-1.2/model.md?raw";
import ras20 from "./ras_table-2.0/model.md?raw";
import rasPeg30 from "./ras_table-peg-3.0/model.md?raw";
import rasPegTable40 from "./ras_table-peg_table-4.0/model.md?raw";
import schell20 from "./schell_table-2.0/model.md?raw";
import schellPeg30 from "./schell_table-peg-3.0/model.md?raw";
import schellPegTable40 from "./schell_table-peg_table-4.0/model.md?raw";
import schellPegTable50 from "./schell_table-peg_table-5.0/model.md?raw";
import schellPegTable60 from "./schell_table-peg_table-6.0/model.md?raw";
import schellPegTable70 from "./schell_table-peg_table-7.0/model.md?raw";
import schellPegTable80 from "./schell_table-peg_table-8.0/model.md?raw";
import schellPegTable90 from "./schell_table-peg_table-9.0/model.md?raw";
import schellPegTable100 from "./schell_table-peg_table-10.0/model.md?raw";

export const MODEL_INFO_ORDER: Opponent[] = [
  "schell_table-peg_table-10.0",
  "schell_table-peg_table-9.0",
  "schell_table-peg_table-8.0",
  "schell_table-peg_table-7.0",
  "schell_table-peg_table-6.0",
  "schell_table-peg_table-5.0",
  "schell_table-peg_table-4.0",
  "ras_table-peg_table-4.0",
  "schell_table-peg-3.0",
  "ras_table-peg-3.0",
  "schell_table-2.0",
  "ras_table-2.0",
  "original_exhaustive_peg-1.2",
  "original-1.1",
];

export const MODEL_DOCS: Record<Opponent, string> = {
  "original-1.1": original11,
  "original_exhaustive_peg-1.2": originalPeg12,
  "ras_table-2.0": ras20,
  "ras_table-peg-3.0": rasPeg30,
  "ras_table-peg_table-4.0": rasPegTable40,
  "schell_table-2.0": schell20,
  "schell_table-peg-3.0": schellPeg30,
  "schell_table-peg_table-4.0": schellPegTable40,
  "schell_table-peg_table-5.0": schellPegTable50,
  "schell_table-peg_table-6.0": schellPegTable60,
  "schell_table-peg_table-7.0": schellPegTable70,
  "schell_table-peg_table-8.0": schellPegTable80,
  "schell_table-peg_table-9.0": schellPegTable90,
  "schell_table-peg_table-10.0": schellPegTable100,
};
