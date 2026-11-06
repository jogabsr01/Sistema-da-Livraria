"""Real WebAuthn signatures from Chromium virtual authenticator; local GAS contract.
No external requests, real Google identities or real customer data are used.
"""
import base64
import json
import os
from pathlib import Path
import subprocess
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
ORIGIN = 'https://dev--merry-chimera-49a1f3.netlify.app'
CREATE = '''async opts => {
 const decode = s => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4-s.length%4)%4)), c=>c.charCodeAt(0));
 const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 opts.challenge = decode(opts.challenge); opts.user.id = decode(opts.user.id);
 opts.excludeCredentials = opts.excludeCredentials.map(c=>({...c,id:decode(c.id)}));
 const c = await navigator.credentials.create({publicKey:opts});
 return {id:c.id, rawId:encode(c.rawId), type:c.type, authenticatorAttachment:c.authenticatorAttachment,
 clientExtensionResults:c.getClientExtensionResults(), response:{clientDataJSON:encode(c.response.clientDataJSON), attestationObject:encode(c.response.attestationObject), transports:c.response.getTransports()}};
}'''
GET = '''async opts => {
 const decode = s => Uint8Array.from(atob(s.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4-s.length%4)%4)), c=>c.charCodeAt(0));
 const encode = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
 opts.challenge = decode(opts.challenge); opts.allowCredentials=opts.allowCredentials.map(c=>({...c,id:decode(c.id)}));
 const c=await navigator.credentials.get({publicKey:opts});
 return {id:c.id,rawId:encode(c.rawId),type:c.type,authenticatorAttachment:c.authenticatorAttachment,
 clientExtensionResults:c.getClientExtensionResults(),response:{clientDataJSON:encode(c.response.clientDataJSON),authenticatorData:encode(c.response.authenticatorData),signature:encode(c.response.signature),userHandle:c.response.userHandle?encode(c.response.userHandle):null}};
}'''
def encode(value):
    return base64.urlsafe_b64encode(value).decode().rstrip('=')
def decode(value):
    return base64.urlsafe_b64decode(value + '=' * ((4-len(value)%4)%4))

class Passkeys(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pw = sync_playwright().start()
        cls.browser = cls.pw.chromium.launch(executable_path=os.environ.get('CHROMIUM','/usr/bin/chromium'),args=['--no-sandbox'])
    @classmethod
    def tearDownClass(cls):
        cls.browser.close(); cls.pw.stop()
    def setUp(self):
        self.server = subprocess.Popen([os.environ.get('NODE','node'),'tests/helpers/passkey-harness.mjs'],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        line = self.server.stdout.readline()
        if not line:
            raise RuntimeError(self.server.stderr.read())
        self.port = json.loads(line)['port']
        self.context = self.browser.new_context()
        self.context.route('**/*', lambda route: route.fulfill(status=200,content_type='text/html',body='<!doctype html><title>Teste local de passkeys DEV</title>'))
        self.page = self.context.new_page(); self.page.goto(ORIGIN)
        self.cdp = self.context.new_cdp_session(self.page); self.cdp.send('WebAuthn.enable')
        self.authenticator = self.cdp.send('WebAuthn.addVirtualAuthenticator',{'options':{'protocol':'ctap2','transport':'internal','hasResidentKey':True,'hasUserVerification':True,'isUserVerified':True,'automaticPresenceSimulation':True}})['authenticatorId']
    def tearDown(self):
        self.context.close(); self.server.terminate(); self.server.communicate(timeout=10)
    def call(self, path, payload=None, status=200):
        req = Request(f'http://127.0.0.1:{self.port}{path}', data=json.dumps(payload or {}).encode(),headers={'content-type':'application/json'})
        try:
            with urlopen(req, timeout=15) as response:
                self.assertEqual(response.status,status)
                return json.load(response)
        except HTTPError as error:
            self.assertEqual(error.code,status)
            return json.load(error)
    def register(self):
        start=self.call('/register/options'); response=self.page.evaluate(CREATE,start['options'])
        self.assertEqual(self.call('/register/verify',{'ceremonyId':start['ceremonyId'],'response':response}),{'registered':True})
        return start,response
    def authentication(self):
        start=self.call('/authenticate/options'); response=self.page.evaluate(GET,start['options'])
        return start,response
    def test_real_registration_and_signature_with_required_user_verification(self):
        start,registered=self.register(); auth,response=self.authentication()
        self.assertEqual(self.call('/authenticate/verify',{'ceremonyId':auth['ceremonyId'],'response':response}),{'verified':True,'assurance':'passkey'})
        state=self.call('/state'); self.assertEqual(state['credentials'],1); self.assertEqual(state['sessions'],0)
        self.assertGreater(state['counters'][0],0)
    def test_registration_and_authentication_ceremonies_cannot_be_replayed(self):
        start,response=self.register()
        self.call('/register/verify',{'ceremonyId':start['ceremonyId'],'response':response},status=401)
        auth,assertion=self.authentication()
        self.call('/authenticate/verify',{'ceremonyId':auth['ceremonyId'],'response':assertion})
        self.call('/authenticate/verify',{'ceremonyId':auth['ceremonyId'],'response':assertion},status=401)
    def test_production_origin_and_modified_challenge_are_rejected(self):
        self.register()
        for field,value in [('origin','https://merry-chimera-49a1f3.netlify.app'),('challenge',encode(b'x'*32))]:
            auth,response=self.authentication(); data=json.loads(decode(response['response']['clientDataJSON'])); data[field]=value
            response['response']['clientDataJSON']=encode(json.dumps(data).encode())
            self.call('/authenticate/verify',{'ceremonyId':auth['ceremonyId'],'response':response},status=401)
    def test_corrupted_signature_is_rejected(self):
        self.register(); auth,response=self.authentication()
        signature=bytearray(decode(response['response']['signature'])); signature[-1]^=1
        response['response']['signature']=encode(signature)
        self.call('/authenticate/verify',{'ceremonyId':auth['ceremonyId'],'response':response},status=401)
    def test_valid_signature_without_user_verification_is_rejected(self):
        self.register(); auth=self.call('/authenticate/options')
        self.cdp.send('WebAuthn.setUserVerified',{'authenticatorId':self.authenticator,'isUserVerified':False})
        auth['options']['userVerification']='discouraged'
        response=self.page.evaluate(GET,auth['options'])
        self.assertEqual(decode(response['response']['authenticatorData'])[32]&4,0)
        self.call('/authenticate/verify',{'ceremonyId':auth['ceremonyId'],'response':response},status=401)
    def test_counter_write_failure_does_not_release_verified_result(self):
        self.register()
        for after in [False,True]:
            auth,response=self.authentication(); self.call('/inject-counter-failure',{'after':after})
            result=self.call('/authenticate/verify',{'ceremonyId':auth['ceremonyId'],'response':response},status=502)
            self.assertIn('error',result); self.assertNotIn('verified',result)
            self.call('/authenticate/verify',{'ceremonyId':auth['ceremonyId'],'response':response},status=401)
            fresh,assertion=self.authentication()
            self.assertTrue(self.call('/authenticate/verify',{'ceremonyId':fresh['ceremonyId'],'response':assertion})['verified'])
            self.assertEqual(self.call('/state')['sessions'],0)
    def test_expired_ceremony_and_other_account_cannot_authorize(self):
        self.register(); auth,response=self.authentication(); self.call('/expire',{'ceremonyId':auth['ceremonyId']})
        self.call('/authenticate/verify',{'ceremonyId':auth['ceremonyId'],'response':response},status=401)
        auth,response=self.authentication()
        self.call('/authenticate/verify',{'ceremonyId':auth['ceremonyId'],'response':response,'testSubject':'other'},status=401)

if __name__=='__main__': unittest.main(verbosity=2)
