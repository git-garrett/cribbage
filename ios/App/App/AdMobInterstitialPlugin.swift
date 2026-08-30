import Capacitor
import GoogleMobileAds
import UIKit

@objc(AdMobInterstitialPlugin)
public class AdMobInterstitialPlugin: CAPPlugin, CAPBridgedPlugin, FullScreenContentDelegate {
    public let identifier = "AdMobInterstitialPlugin"
    public let jsName = "AdMobInterstitial"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "prepare", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "show", returnType: CAPPluginReturnPromise),
    ]

    private static let testInterstitialAdUnitID = "ca-app-pub-3940256099942544/4411468910"

    private var interstitial: InterstitialAd?
    private var loadedAdUnitID: String?
    private var loadingAdUnitID: String?
    private var presentationCall: CAPPluginCall?

    override public func load() {
        DispatchQueue.main.async {
            MobileAds.shared.start()
        }
    }

    @objc public func prepare(_ call: CAPPluginCall) {
        guard let requestedAdUnitID = call.getString("adUnitId"), !requestedAdUnitID.isEmpty else {
            call.reject("An AdMob interstitial ad unit ID is required.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.prepareInterstitial(requestedAdUnitID: requestedAdUnitID, call: call)
        }
    }

    @objc public func show(_ call: CAPPluginCall) {
        guard let requestedAdUnitID = call.getString("adUnitId"), !requestedAdUnitID.isEmpty else {
            call.reject("An AdMob interstitial ad unit ID is required.")
            return
        }

        DispatchQueue.main.async { [weak self] in
            self?.showInterstitial(requestedAdUnitID: requestedAdUnitID, call: call)
        }
    }

    private func prepareInterstitial(requestedAdUnitID: String, call: CAPPluginCall) {
        let adUnitID = effectiveAdUnitID(requestedAdUnitID)
        if interstitial != nil, loadedAdUnitID == adUnitID {
            call.resolve(["ready": true])
            return
        }
        if loadingAdUnitID == adUnitID {
            call.resolve(["ready": false, "reason": "loading"])
            return
        }

        interstitial = nil
        loadedAdUnitID = nil
        loadingAdUnitID = adUnitID

        Task { @MainActor [weak self] in
            guard let self else { return }
            do {
                let ad = try await InterstitialAd.load(with: adUnitID, request: Request())
                ad.fullScreenContentDelegate = self
                self.interstitial = ad
                self.loadedAdUnitID = adUnitID
                self.loadingAdUnitID = nil
                call.resolve(["ready": true])
            } catch {
                self.loadingAdUnitID = nil
                call.resolve([
                    "ready": false,
                    "reason": "load_failed",
                    "message": error.localizedDescription,
                ])
            }
        }
    }

    private func showInterstitial(requestedAdUnitID: String, call: CAPPluginCall) {
        guard presentationCall == nil else {
            call.resolve(["shown": false, "reason": "already_presenting"])
            return
        }

        let adUnitID = effectiveAdUnitID(requestedAdUnitID)
        guard let interstitial, loadedAdUnitID == adUnitID else {
            call.resolve(["shown": false, "reason": loadingAdUnitID == adUnitID ? "loading" : "not_ready"])
            return
        }
        guard let viewController = bridge?.viewController else {
            call.resolve(["shown": false, "reason": "no_view_controller"])
            return
        }

        presentationCall = call
        self.interstitial = nil
        loadedAdUnitID = nil
        interstitial.present(from: viewController)
    }

    public func ad(
        _ ad: FullScreenPresentingAd,
        didFailToPresentFullScreenContentWithError error: Error
    ) {
        finishPresentation(shown: false, reason: "presentation_failed", message: error.localizedDescription)
    }

    public func adDidDismissFullScreenContent(_ ad: FullScreenPresentingAd) {
        finishPresentation(shown: true)
    }

    private func finishPresentation(shown: Bool, reason: String? = nil, message: String? = nil) {
        var result: [String: Any] = ["shown": shown]
        if let reason {
            result["reason"] = reason
        }
        if let message {
            result["message"] = message
        }
        presentationCall?.resolve(result)
        presentationCall = nil
    }

    private func effectiveAdUnitID(_ requestedAdUnitID: String) -> String {
#if DEBUG
        return Self.testInterstitialAdUnitID
#else
        return requestedAdUnitID
#endif
    }
}
