/** CLI: npx tsx tools/offline/render/measure-model.ts [caseId] — prints the proportion table of a case. */
import { loadCaseById } from '@/cases';
import { formatMeasurements, measureModel } from '@/simulator/anatomy/measureModel';

const c = loadCaseById(process.argv[2] ?? 'normal-excellent-window');
process.stdout.write(formatMeasurements(measureModel(c)) + '\n');
