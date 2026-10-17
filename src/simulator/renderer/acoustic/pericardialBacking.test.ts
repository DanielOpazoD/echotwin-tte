/**
 * The pericardium's interface echo is that of collagen against the fat on both sides of the sac, not that of a lung
 * interface (decision 333): its specular coefficient follows from the tissues' impedances.
 */
import { describe, expect, it } from 'vitest';
import { Tissue, TISSUE_IMPEDANCE_MRAYL, TISSUE_PROPS } from '@/simulator/anatomy/tissue';
import { echoOverLung, interfaceReflection } from './acoustics';

const Z = TISSUE_IMPEDANCE_MRAYL;

describe('the pericardial interface echo from the impedances', () => {
  it('gives every tissue of the table an impedance', () => {
    for (const t of Object.keys(TISSUE_PROPS).map(Number))
      expect(Z[t], `impedance of ${TISSUE_PROPS[t]!.name}`).toBeGreaterThan(0);
  });

  it('sets the pericardium’s specular coefficient to its echo against fat over a lung interface', () => {
    const lung = TISSUE_PROPS[Tissue.Lung]!.specular;
    const expected = lung * echoOverLung(Z[Tissue.Pericardium]!, Z[Tissue.Fat]!, Z[Tissue.Lung]!);
    expect(TISSUE_PROPS[Tissue.Pericardium]!.specular).toBeCloseTo(expected, 2);
    expect(expected).toBeGreaterThan(0.1);
    expect(expected).toBeLessThan(0.25);
  });

  it('orders the interfaces of collagen as their impedance contrast does', () => {
    const zp = Z[Tissue.Pericardium]!;
    const backs = [Tissue.Myocardium, Tissue.Fluid, Tissue.Fat, Tissue.Lung];
    const r = backs.map((t) => interfaceReflection(zp, Z[t]!));
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeGreaterThan(r[i - 1]!);
    expect(echoOverLung(zp, Z[Tissue.Lung]!, Z[Tissue.Lung]!)).toBe(1);
    expect(echoOverLung(zp, zp, Z[Tissue.Lung]!)).toBe(0);
  });
});
