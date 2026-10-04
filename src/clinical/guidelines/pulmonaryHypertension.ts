/** ASE right-heart 2025, hemodynamic assessment, DOI 10.1016/j.echo.2025.01.006.
 * Suggestive echocardiographic findings, not invasive diagnosis or a high-probability category.
 * This reduced assessment uses only the adjunctive signs available in the synthetic model.
 */
export function pulmonaryHypertensionEvidence(input: {
  trVelocityMps: number | null;
  rvBasalDiameterCm: number;
  ivcDiameterCm: number;
  rvotObstruction?: boolean;
}) {
  const signs: string[] = [];
  // Table 2: basal RV diameter >=4.1 cm is enlarged. Do not substitute a PLAX LV diameter for an A4C basal ratio.
  if (Number.isFinite(input.rvBasalDiameterCm) && input.rvBasalDiameterCm >= 4.1)
    signs.push('rv-enlargement');
  if (Number.isFinite(input.ivcDiameterCm) && input.ivcDiameterCm > 2.1) signs.push('dilated-ivc');
  const tr = input.trVelocityMps;
  const applicable = tr !== null && Number.isFinite(tr) && tr >= 0 && !input.rvotObstruction;
  const suggestive = applicable && (tr >= 2.9 || (tr >= 2.8 && signs.length >= 2));
  return { applicable, suggestive, adjunctiveSigns: signs, referenceId: 'ase-right-heart-2025' };
}
