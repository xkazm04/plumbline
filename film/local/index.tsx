// The film's bespoke heroes, merged over the demo-film kit's library as @film/local.
// IntroHero opens the film; ExamplesHero names the three examples (and reprises them at the close); each example
// opens on its concept, drawn over the first seconds of its beat before the real page.
import { AgentConcept, ClinicConcept, GuesthouseConcept } from './Concepts.tsx';
import { ExamplesHero } from './ExamplesHero.tsx';
import { IntroHero } from './IntroHero.tsx';

export const components = { IntroHero, ExamplesHero, GuesthouseConcept, ClinicConcept, AgentConcept };
