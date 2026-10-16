import unittest
from unittest.mock import patch
from evaluation_runner import worker_type


class AdapterTests(unittest.TestCase):
    def test_only_reference_matches_use_recorder_and_original_requests_are_preserved(self):
        class Base:
            def __init__(self,*args):self.args=args
            def call(self,request):
                self.request=request
                return dict(benchmark=dict(schemaVersion=1))
        extension=dict(binary='recorder',files={'recorder':'new-hash'},trainingBinarySha256='old-hash')
        worker=worker_type(Base,extension)
        train=worker('original','current')
        self.assertEqual(train.args,('original','current',None))
        request=dict(kind='game',seed=12)
        with patch('evaluation_runner.sha',side_effect=['candidate-manifest','reference-manifest']):
            evaluate=worker('original','current','reference')
        result=evaluate.call(request)
        self.assertIs(evaluate.request,request)
        self.assertEqual(evaluate.args,('recorder','current','reference'))
        self.assertEqual(result['benchmark']['snapshots'],['candidate-manifest','reference-manifest'])
        self.assertEqual(result['benchmark']['policyBinarySha256'],'old-hash')


if __name__=='__main__':unittest.main()
