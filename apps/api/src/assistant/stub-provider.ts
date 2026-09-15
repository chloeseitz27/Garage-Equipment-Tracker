import type { AssistantProvider, AssistantRecommendation, Item } from '@garage/shared';

/**
 * Offline provider that selects from candidates by `goodFor` overlap.
 *
 * It keeps the app demoable with no network and no API key, makes the grounding
 * layer testable deterministically, and is the thing that saves the demo if the
 * real API is unreachable at the worst possible moment (technical-spec.md §6.3).
 */
export class StubAssistantProvider implements AssistantProvider {
  readonly name = 'stub';

  async recommend(input: {
    projectDescription: string;
    candidates: Item[];
  }): Promise<AssistantRecommendation> {
    const { projectDescription, candidates } = input;

    // Candidates arrive already ranked by the retrieval step, so keep that order
    // and take a useful spread of equipment and consumables.
    const equipment = candidates.filter((item) => item.kind === 'equipment').slice(0, 6);
    const consumables = candidates.filter((item) => item.kind === 'consumable').slice(0, 4);

    const garageItems = [...equipment, ...consumables].map((item) => ({
      id: item.id,
      reason: item.goodFor[0]
        ? `Useful here for ${item.goodFor[0]}.`
        : `Commonly used for projects like this.`,
    }));

    return {
      understoodAs: `Project: ${projectDescription.trim().replace(/\s+/g, ' ').slice(0, 140)}`,
      garageItems,
      // The stub has no way to reason about what the Garage lacks, and inventing
      // entries here would be exactly the dishonesty the spec forbids.
      notInGarage: [],
    };
  }
}
