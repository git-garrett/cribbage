import copy
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_model284_late_beliefs as b
from test_build_model20_discard_evidence import create_database, add_game


class LateBeliefTests(unittest.TestCase):
    def test_prior_strength_is_probability_mass_not_historical_sample_count(self):
        q={'a':.25,'b':.75}
        self.assertEqual(b.posterior(q,{},10),q)
        p=b.posterior(q,{'a':3},10)
        self.assertAlmostEqual(p['a'],5.5/13)
        self.assertAlmostEqual(sum(p.values()),1.)
        self.assertEqual(b.posterior(q,{'a':1000},None),q)
        self.assertGreater(b.posterior({'a':1-1e-15,'b':1e-15},{'a':10000},1)['b'],0)
        for row in ({'c':1},{'a':-1}):
            with self.assertRaises(ValueError): b.posterior(q,row,10)

    def test_role_score_and_actor_eligibility_boundaries(self):
        self.assertFalse(b.late(110))
        self.assertTrue(b.late(111))
        self.assertTrue(b.late(120))
        for value in (-1,121,None,111.,True):
            with self.assertRaises(ValueError): b.late(value)
        for version in ('15.2','16.1','20.5-renamed','28.3.fast','unknown'):
            self.assertFalse(b.eligible('schell_table-peg_table-'+version))

    def test_extract_excludes_prior_seeds_duplicates_and_defunct_actor(self):
        with tempfile.TemporaryDirectory() as directory:
            output=Path(directory)
            raw=output/'raw.db'
            db=create_database(raw)
            for name,index,seed in [('new',0,'new-seed'),('replay',1,'new-seed'),('prior',2,'prior-seed')]:
                add_game(db,name,index,left='20.3',right='15.2',seed=seed)
            db.execute('ALTER TABLE compact_hands ADD COLUMN peg_sequence BLOB')
            for name in ['new','replay','prior']:
                db.execute('UPDATE compact_hands SET start_left_score=111,start_right_score=120,peg_sequence=? WHERE game_id=?',
                           (bytes([0,0,0,0,0]),name))
            engines=['schell_table-peg_table-20.3','schell_table-peg_table-15.2']
            metadata=dict(left=engines[0],right=engines[1],sourceCommit='a'*40,runnerSha256='b'*64,frozenEngine=None)
            db.execute('CREATE TABLE ai_runs (run_id TEXT,metadata_json TEXT)')
            db.execute('INSERT INTO ai_runs VALUES (?,?)',('run',json.dumps(metadata)))
            provenance=b.run_provenance(db,engines)
            db.commit(); db.close()
            config=dict(sources=[dict(path=str(raw),engines=engines,runProvenance=provenance,qualification='test')])
            frozen=b.freeze_sources(config,output)
            value,counts=b.extract(config,output,frozen,{'prior-seed'})
            self.assertEqual(value['statistics']['priorSeedGamesExcluded'],1)
            self.assertEqual(value['statistics']['duplicateGamesExcluded'],1)
            self.assertEqual(value['statistics']['excludedActorHands'],1)
            self.assertEqual(len(value['games']),1)
            self.assertTrue(all(r['model']=='schell_table-peg_table-20.3' for r in value['modelCounts']))
            self.assertEqual(sum(sum(row.values()) for kinds in counts.values() for row in kinds['hold'].values()),2)
            changed=copy.deepcopy(config); changed['sources'][0]['path']='different'
            with self.assertRaisesRegex(ValueError,'new output directory'): b.freeze_sources(changed,output)

    def test_test_labels_cannot_select_prior_strength_or_leak_into_update(self):
        priors={}
        counts={s:dict(hold={},discards={}) for s in b.SPLITS}
        for role in b.ROLES:
            context='4000000000000'
            key=(role,context)
            priors[key]={'0200000000000':.5,'0020000000000':.5}
            counts['train']['discards'][key]={'0200000000000':50}
            counts['tune']['discards'][key]={'0020000000000':20}
        first,audit=b.select(priors,counts,'discards')
        for key in priors: counts['test']['discards'][key]={'0200000000000':10000000}
        second,other=b.select(priors,counts,'discards')
        self.assertEqual(first,second)
        self.assertEqual(audit,other)
        self.assertEqual(first,priors)  # Pooling remains a real tuning option.

    def test_packed_prior_support_and_physical_conditioning(self):
        hb,db,_,_=b.checked_priors(b.ROOT)
        h=b.read_hold(hb); d,suits,metadata=b.read_discards(db)
        self.assertEqual(b.validate_rows(h,'hold')['contexts'],1120)
        self.assertEqual(b.validate_rows(d,'discards')['positiveCells'],330590)
        copy_bytes=b.pack_discards(d,suits,metadata)
        unpacked,_,_=b.read_discards(copy_bytes)
        self.assertEqual(unpacked,d)
        prefix='0000000000000'; own='4000020000000'; keep='0000004000000'
        for role in b.ROLES:
            p=b.conditioned_hold(h[(role,prefix)],prefix,own,1)
            self.assertAlmostEqual(sum(p.values()),1.)
            self.assertTrue(all(key[0]=='0' for key in p))
            p=b.conditioned_discard(d[(role,keep)],keep,own,1)
            self.assertAlmostEqual(sum(p.values()),1.)
            self.assertTrue(all(key[0]=='0' and key[6]=='0' for key in p))
            with self.assertRaises(ValueError): b.conditioned_discard(d[(role,keep)],keep,'0000006000000',1)


if __name__=='__main__': unittest.main()
