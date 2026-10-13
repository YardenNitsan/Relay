import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Arrays;
import java.util.Comparator;
import javax.xml.parsers.DocumentBuilderFactory;

/** JDK-only build configuration regression checks; not Android TLS acceptance. */
public final class LanTrustConfigTest {
    private static int passed;
    private interface Checked { void run() throws Exception; }
    private static void check(boolean value, String description) {
        if (!value) throw new AssertionError(description);
        passed++;
    }
    private static void rejects(Checked operation, String description) throws Exception {
        try { operation.run(); } catch (Exception expected) { passed++; return; }
        throw new AssertionError(description);
    }
    private static void keytool(String... arguments) throws Exception {
        String tool = Path.of(System.getProperty("java.home"), "bin", System.getProperty("os.name").startsWith("Windows") ? "keytool.exe" : "keytool").toString();
        var command = new java.util.ArrayList<String>(); command.add(tool); command.addAll(Arrays.asList(arguments));
        Process process = new ProcessBuilder(command).redirectErrorStream(true).start();
        byte[] output = process.getInputStream().readAllBytes();
        if (process.waitFor() != 0) throw new AssertionError(new String(output, StandardCharsets.UTF_8));
    }
    public static void main(String[] args) throws Exception {
        Path temporary = Files.createTempDirectory("relay-build-ca-test-");
        try {
            String store = temporary.resolve("fixture.p12").toString();
            keytool("-genkeypair", "-alias", "ca", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=Build fixture CA", "-ext", "bc:c", "-ext", "ku=keyCertSign,cRLSign", "-validity", "2", "-keystore", store, "-storepass", "fixture-only", "-noprompt");
            Path pem = temporary.resolve("ca.pem"), der = temporary.resolve("ca.der");
            keytool("-exportcert", "-rfc", "-alias", "ca", "-keystore", store, "-storepass", "fixture-only", "-file", pem.toString());
            keytool("-exportcert", "-alias", "ca", "-keystore", store, "-storepass", "fixture-only", "-file", der.toString());
            byte[] raw = Files.readAllBytes(der), armored = Files.readAllBytes(pem);
            check(Arrays.equals(raw, LanTrustConfig.validateCertificate(raw)), "DER accepted unchanged");
            check(Arrays.equals(raw, LanTrustConfig.validateCertificate(armored)), "PEM normalized to DER");
            rejects(() -> LanTrustConfig.validateCertificate(new byte[0]), "Empty rejected");
            rejects(() -> LanTrustConfig.validateCertificate(new byte[65537]), "Oversize rejected");
            rejects(() -> LanTrustConfig.validateCertificate(Arrays.copyOf(raw, raw.length + 1)), "DER trailing bytes rejected");
            rejects(() -> LanTrustConfig.validateCertificate((new String(armored, StandardCharsets.US_ASCII).repeat(2)).getBytes(StandardCharsets.US_ASCII)), "PEM chain rejected");
            rejects(() -> LanTrustConfig.validateCertificate((new String(armored, StandardCharsets.US_ASCII) + "-----BEGIN PRIVATE KEY-----\nAA==\n-----END PRIVATE KEY-----").getBytes(StandardCharsets.US_ASCII)), "Private material rejected");
            keytool("-genkeypair", "-alias", "leaf", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=Build fixture leaf", "-validity", "2", "-keystore", store, "-storepass", "fixture-only", "-noprompt");
            Path leaf = temporary.resolve("leaf.der");
            keytool("-exportcert", "-alias", "leaf", "-keystore", store, "-storepass", "fixture-only", "-file", leaf.toString());
            rejects(() -> LanTrustConfig.validateCertificate(Files.readAllBytes(leaf)), "Server certificate rejected");
            keytool("-genkeypair", "-alias", "expired", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=Expired build fixture CA", "-ext", "bc:c", "-ext", "ku=keyCertSign", "-startdate", "2020/01/01 00:00:00", "-validity", "1", "-keystore", store, "-storepass", "fixture-only", "-noprompt");
            Path expired = temporary.resolve("expired.der");
            keytool("-exportcert", "-alias", "expired", "-keystore", store, "-storepass", "fixture-only", "-file", expired.toString());
            rejects(() -> LanTrustConfig.validateCertificate(Files.readAllBytes(expired)), "Expired CA rejected");
            keytool("-genkeypair", "-alias", "wrong-usage", "-keyalg", "RSA", "-keysize", "2048", "-dname", "CN=Wrong usage build fixture CA", "-ext", "bc:c", "-ext", "ku=digitalSignature", "-validity", "2", "-keystore", store, "-storepass", "fixture-only", "-noprompt");
            Path wrongUsage = temporary.resolve("wrong-usage.der");
            keytool("-exportcert", "-alias", "wrong-usage", "-keystore", store, "-storepass", "fixture-only", "-file", wrongUsage.toString());
            rejects(() -> LanTrustConfig.validateCertificate(Files.readAllBytes(wrongUsage)), "CA without signing usage rejected");
            for (String host : new String[]{"8.8.8.8", "127.0.0.1", "0.0.0.0", "169.254.1.2", "100.64.0.1", "172.15.0.1", "172.32.0.1", "192.169.1.2", "10.256.0.1", "10.01.0.1", "10.1", "0x0a000001", "fd00::1", "localhost", "10.100.102.13:4443", "10.100.102.13 ", "https://10.100.102.13", "*.local", "10.100.102.13</domain>", "10.100.102.13@evil.example", "10.100.102.13\n", "10.100.102.13\r\n"})
                rejects(() -> LanTrustConfig.networkConfig(host), "Other domain rejected");
            var factory = DocumentBuilderFactory.newInstance();
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            var xml = factory.newDocumentBuilder().parse(new ByteArrayInputStream(LanTrustConfig.networkConfig("10.100.102.13").getBytes(StandardCharsets.UTF_8)));
            var xpath = javax.xml.xpath.XPathFactory.newInstance().newXPath();
            for (String host : new String[]{"10.100.102.30", "10.0.0.1", "172.16.0.1", "172.31.255.254", "192.168.1.2"}) {
                var scoped = factory.newDocumentBuilder().parse(new ByteArrayInputStream(LanTrustConfig.networkConfig(host).getBytes(StandardCharsets.UTF_8)));
                check(xpath.evaluate("/network-security-config/domain-config/domain", scoped).equals(host), "Selected private IP preserved exactly");
                check(xpath.evaluate("count(//domain)", scoped).equals("1"), "Exactly one domain");
            }
            rejects(() -> LanTrustConfig.networkConfig(null), "Missing host rejected");
            rejects(() -> LanTrustConfig.networkConfig(""), "Empty host rejected");
            check(xpath.evaluate("/network-security-config/domain-config/domain", xml).equals("10.100.102.13"), "Exact IP domain");
            check(xpath.evaluate("/network-security-config/domain-config/domain/@includeSubdomains", xml).equals("false"), "No subdomains");
            check(xpath.evaluate("/network-security-config/base-config/trust-anchors/certificates/@src", xml).equals("system"), "System-only base");
            check(xpath.evaluate("/network-security-config/domain-config/trust-anchors/certificates/@src", xml).equals("@raw/relay_lan_ca"), "Private CA only within domain");
            check(xpath.evaluate("count(//debug-overrides | //certificates[@src='user'] | //*[@cleartextTrafficPermitted='true'])", xml).equals("0"), "No broadening bypass");
            Path generated = temporary.resolve("res");
            LanTrustConfig.main(new String[]{pem.toString(), "10.100.102.13", generated.toString()});
            check(Arrays.equals(raw, Files.readAllBytes(generated.resolve("raw/relay_lan_ca.der"))), "Generator copies public DER only");
            check(Files.readString(generated.resolve("xml/relay_lan_network_security_config.xml")).equals(LanTrustConfig.networkConfig("10.100.102.13")), "Generated XML exact");
            System.out.println("LAN build trust checks passed: " + passed);
        } finally {
            try (var paths = Files.walk(temporary)) {
                for (Path path : paths.sorted(Comparator.reverseOrder()).toList()) Files.delete(path);
            }
        }
    }
}
