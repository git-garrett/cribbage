import Capacitor

@objc(AppBridgeViewController)
public class AppBridgeViewController: CAPBridgeViewController {
    override public func capacitorDidLoad() {
        bridge?.registerPluginInstance(AdMobInterstitialPlugin())
    }
}
