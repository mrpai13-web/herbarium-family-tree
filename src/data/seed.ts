/**
 * Sample family for first launch: the Ashby–Lund family, three generations,
 * covering every relationship style (birth, adoption, step, marriage, divorce).
 * Clearly fictional; "Start a new tree" in the menu clears it.
 */
import { computePeaks } from '../core/waveform';
import { newId } from '../core/relations';
import type { FamilyGraph, Group, MediaRecord, ParentKind, Person, Union } from '../core/types';
import { placeholderAudio, placeholderPhoto } from './media';

export function buildSeed(): { graph: FamilyGraph; media: MediaRecord[] } {
  const now = Date.now();
  const people: Record<string, Person> = {};
  const media: MediaRecord[] = [];
  const P = (key: string, p: Partial<Person> & Pick<Person, 'givenName' | 'surname' | 'sex'>) => {
    const id = newId();
    people[id] = { id, galleryIds: [], audioIds: [], createdAt: now, updatedAt: now, ...p };
    ids[key] = id;
    return id;
  };
  const ids: Record<string, string> = {};

  P('walter', {
    givenName: 'Walter', surname: 'Ashby', sex: 'male', birthDate: '1938-11-02', deathDate: '2019-04-11',
    birthplace: 'Hull, England',
    bio: 'Walter ran the chandlery on Humber Street for thirty years and could tie a bowline one-handed. In 1998 he recorded six cassettes of sea stories; the first is digitised here.',
  });
  P('margaret', {
    givenName: 'Margaret', surname: 'Ashby', nickname: 'Peggy', birthSurname: 'Lund', sex: 'female',
    birthDate: '1941-03-14', birthplace: 'Karlstad, Sweden',
    bio: 'Peggy came to Hull in 1959 to sew for Rosen & Co., and met Walter at a dance hall that flooded the same night. She kept the household accounts in a green ledger for fifty-one years, and still writes every grandchild a letter on their birthday.',
  });
  P('tomas', {
    givenName: 'Tomás', surname: 'Reyes', sex: 'male', birthDate: '1962', birthplace: 'Valparaíso, Chile',
    bio: 'Tomás came from Valparaíso to study naval architecture and stayed for Eleanor. He makes empanadas for every family birthday from his mother’s handwritten recipe card.',
  });
  P('eleanor', {
    givenName: 'Eleanor', surname: 'Reyes', birthSurname: 'Ashby', sex: 'female', birthDate: '1964-06-21',
    birthplace: 'Hull, England',
    bio: 'Eleanor taught music at St Peter’s for thirty-four years. The upright piano in so many family photos was Walter’s wedding gift to Peggy.',
  });
  P('samuel', {
    givenName: 'Samuel', surname: 'Ashby', sex: 'male', birthDate: '1970', birthplace: 'Leeds, England',
    bio: 'Samuel joined the Ashbys at four, in the summer of 1974. He looks after the family’s photo archive and scanned most of what you see in this tree.',
  });
  P('daniel', {
    givenName: 'Daniel', surname: 'Ashby', sex: 'male', birthDate: '1967-09-30', birthplace: 'Hull, England',
    bio: 'Daniel is a civil engineer who has since rebuilt two of the bridges his father used to sail under.',
  });
  P('claire', {
    givenName: 'Claire', surname: 'Moreau', sex: 'female', birthDate: '1969', birthplace: 'Lyon, France',
    bio: 'Claire and Daniel were married from 1994 to 2003. She lives in Lyon, and June spends every August with her.',
  });
  P('priya', {
    givenName: 'Priya', surname: 'Nair', sex: 'female', birthDate: '1972', birthplace: 'Kochi, India',
    bio: 'Priya, a paediatric nurse from Kochi, married Daniel in 2006 and helped raise June from the age of eight.',
  });
  P('lucia', {
    givenName: 'Lucia', surname: 'Reyes', sex: 'female', birthDate: '1993-02-08', birthplace: 'Manchester, England',
    bio: 'Lucia is the family’s recorder-in-chief: most of Peggy’s voice memories were captured on her phone at Sunday lunch.',
  });
  P('june', {
    givenName: 'June', surname: 'Ashby', sex: 'female', birthDate: '1998-07-17', birthplace: 'Bristol, England',
    bio: 'June studies textile conservation and is restoring Peggy’s 1962 wedding dress, one seam at a time.',
  });
  P('theo', {
    givenName: 'Theo', surname: 'Ashby', sex: 'male', birthDate: '2008-12-01', birthplace: 'Bristol, England',
    bio: 'Theo is the youngest Ashby and the newest leaf on the tree.',
  });

  const parentLinks: FamilyGraph['parentLinks'] = {};
  const link = (p: string, c: string, kind: ParentKind = 'biological', since?: string) => {
    const id = newId();
    parentLinks[id] = { id, parentId: ids[p], childId: ids[c], kind, since };
  };
  link('walter', 'eleanor'); link('margaret', 'eleanor');
  link('walter', 'daniel'); link('margaret', 'daniel');
  link('walter', 'samuel', 'adoptive', '1974'); link('margaret', 'samuel', 'adoptive', '1974');
  link('tomas', 'lucia'); link('eleanor', 'lucia');
  link('daniel', 'june'); link('claire', 'june');
  link('priya', 'june', 'step', '2006');
  link('daniel', 'theo'); link('priya', 'theo');

  const unions: FamilyGraph['unions'] = {};
  const unite = (a: string, b: string, status: Union['status'], start?: string, end?: string) => {
    const id = newId();
    unions[id] = { id, partners: [ids[a], ids[b]], kind: 'married', status, start, end };
  };
  unite('walter', 'margaret', 'widowed', '1962-05-19', '2019');
  unite('tomas', 'eleanor', 'current', '1990');
  unite('claire', 'daniel', 'divorced', '1994', '2003');
  unite('daniel', 'priya', 'current', '2006');

  // Placeholder gallery photos.
  const photo = (who: string, seed: number, caption: string, figs: number) => {
    const blob = placeholderPhoto(seed, figs);
    const id = newId();
    media.push({ id, kind: 'image', personId: ids[who], mime: blob.type, caption, width: 800, height: 640, blob, thumb: blob, createdAt: now });
    people[ids[who]].galleryIds.push(id);
  };
  photo('margaret', 0, 'Karlstad, 1955', 1);
  photo('margaret', 1, 'Wedding, 1962', 2);
  photo('margaret', 2, 'Bridlington, 1971', 3);
  photo('walter', 3, 'Humber St, 1966', 1);
  photo('walter', 1, 'Wedding, 1962', 2);
  photo('eleanor', 2, 'First recital, 1975', 1);
  photo('june', 0, 'Lyon, August 2010', 2);

  // Placeholder voice memories (synthesized tones, so the player has something to play).
  const audio = (who: string, seed: number, title: string, recordedAt: string, secs: number) => {
    const a = placeholderAudio(seed, secs);
    const id = newId();
    media.push({
      id, kind: 'audio', personId: ids[who], mime: 'audio/wav', title, recordedAt,
      duration: a.samples.length / a.rate, peaks: computePeaks(a.samples, 72), blob: a.blob, createdAt: now,
    });
    people[ids[who]].audioIds.push(id);
  };
  audio('margaret', 3, 'The night the dance hall flooded', '2024-03', 11);
  audio('margaret', 8, 'How to make kanelbullar, properly', '2023-12', 8);
  audio('walter', 5, 'Sea stories, tape 1 of 6', '1998', 12);

  const group = (name: string, color: string, keys: string[], core = false): Group => ({
    id: newId(), name, color, memberIds: keys.map((k) => ids[k]), createdAt: now + Object.keys(groups).length, ...(core ? { core } : {}),
  });
  const groups: Record<string, Group> = {};
  for (const gr of [
    group('The Ashby Family', '#3E6B48', ['walter', 'margaret', 'eleanor', 'daniel', 'samuel', 'june', 'theo'], true),
    group('The Reyes Family', '#A9566B', ['tomas', 'eleanor', 'lucia']),
  ])
    groups[gr.id] = gr;

  return { graph: { people, parentLinks, unions, groups }, media };
}
