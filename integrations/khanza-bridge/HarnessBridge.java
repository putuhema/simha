package simrskhanza;

import fungsi.akses;
import fungsi.sekuel;
import java.awt.Dimension;
import java.awt.Toolkit;
import java.awt.Window;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;
import javax.swing.SwingUtilities;
import rekammedis.RMDataResumePasien;
import rekammedis.RMDataResumePasienRanap;
import rekammedis.RMRiwayatPerawatan;

/**
 * Bridge for the SIMRS Harness desktop app: lets "Buka di Khanza" open a
 * given form for a given visit in this running Khanza.
 *
 * After a login it listens on 127.0.0.1 (a free port) and writes the port and
 * a random token to ~/.simrs-harness/khanza-bridge.properties, readable only
 * by this OS user. One request per connection, one line, tab-separated:
 *
 *   TOKEN \t ping                    -> "OK <user>"
 *   TOKEN \t open \t FORM \t VALUE   -> "OK" or "ERR <reason>"
 *   TOKEN \t fill \t resume_ranap \t NO_RAWAT \t key=base64;...  -> "OK baru" / "OK ganti" / "ERR"
 *
 * "fill" opens Resume Pasien Ranap for the visit with the given values put
 * into its fields (an existing resume is selected first, like before Ganti).
 * It never saves: the user checks the form and clicks Simpan or Ganti.
 *
 * FORM: resume / soap (ranap or ralan, from the visit), resume_ranap,
 * resume_ralan, soap_ranap, soap_ralan (VALUE = no. rawat), riwayat (VALUE =
 * no. rawat or no. RM).
 *
 * Only the forms in open() can be opened, only with a no. rawat / no. RM, and
 * only when the logged-in user may open that form in Khanza (akses), so the
 * bridge never gives more access than the Khanza menu. Forms are opened the
 * same way Khanza's own patient lists open them. Stopped at logout.
 */
public final class HarnessBridge {

    private static final Pattern NO_RAWAT = Pattern.compile("\\d{4}/\\d{2}/\\d{2}/\\d{6}");
    private static final Pattern NO_RM = Pattern.compile("[0-9A-Za-z.-]{1,15}");
    /** A filled resume (base64 values) can be a few kB; anything far larger is not ours. */
    private static final int MAX_LINE = 256 * 1024;

    /** resume_pasien_ranap column -> field of RMDataResumePasienRanap (what its Simpan reads). */
    private static final java.util.Map<String, String> RESUME_RANAP_FIELDS = new java.util.LinkedHashMap<String, String>();

    static {
        String[][] pairs = {
            {"diagnosa_awal", "DiagnosaAwal"}, {"alasan", "Alasan"}, {"keluhan_utama", "KeluhanUtama"},
            {"pemeriksaan_fisik", "PemeriksaanFisik"}, {"jalannya_penyakit", "JalannyaPenyakit"},
            {"pemeriksaan_penunjang", "PemeriksaanRad"}, {"hasil_laborat", "HasilLaborat"},
            {"tindakan_dan_operasi", "TindakanSelamaDiRS"}, {"obat_di_rs", "ObatSelamaDiRS"},
            {"diagnosa_utama", "DiagnosaUtama"}, {"kd_diagnosa_utama", "KodeDiagnosaUtama"},
            {"diagnosa_sekunder", "DiagnosaSekunder1"}, {"kd_diagnosa_sekunder", "KodeDiagnosaSekunder1"},
            {"diagnosa_sekunder2", "DiagnosaSekunder2"}, {"kd_diagnosa_sekunder2", "KodeDiagnosaSekunder2"},
            {"diagnosa_sekunder3", "DiagnosaSekunder3"}, {"kd_diagnosa_sekunder3", "KodeDiagnosaSekunder3"},
            {"diagnosa_sekunder4", "DiagnosaSekunder4"}, {"kd_diagnosa_sekunder4", "KodeDiagnosaSekunder4"},
            {"prosedur_utama", "ProsedurUtama"}, {"kd_prosedur_utama", "KodeProsedurUtama"},
            {"prosedur_sekunder", "ProsedurSekunder1"}, {"kd_prosedur_sekunder", "KodeProsedurSekunder1"},
            {"prosedur_sekunder2", "ProsedurSekunder2"}, {"kd_prosedur_sekunder2", "KodeProsedurSekunder2"},
            {"prosedur_sekunder3", "ProsedurSekunder3"}, {"kd_prosedur_sekunder3", "KodeProsedurSekunder3"},
            {"alergi", "Alergi"}, {"diet", "Diet"}, {"lab_belum", "LabBelum"}, {"edukasi", "Edukasi"},
            {"cara_keluar", "CaraKeluar"}, {"ket_keluar", "KetKeluar"}, {"keadaan", "Keadaan"},
            {"ket_keadaan", "KetKeadaanPulang"}, {"dilanjutkan", "DIlanjutkan"}, {"ket_dilanjutkan", "KetDilanjutkan"},
            {"kontrol", "Kontrol"}, {"obat_pulang", "ObatPulang"},
        };
        for (String[] pair : pairs) {
            RESUME_RANAP_FIELDS.put(pair[0], pair[1]);
        }
    }

    private static ServerSocket server;
    private static Thread acceptor;
    private static String token;

    private HarnessBridge() {
    }

    /** The file the desktop app reads to find the bridge. */
    public static File infoFile() {
        return new File(new File(System.getProperty("user.home"), ".simrs-harness"), "khanza-bridge.properties");
    }

    /** Starts listening after a successful login. Never throws: Khanza works the same without the bridge. */
    public static synchronized void start() {
        if (akses.getjml1() < 1 && akses.getjml2() < 1) {
            return;
        }
        stop();
        try {
            byte[] bytes = new byte[24];
            new SecureRandom().nextBytes(bytes);
            StringBuilder hex = new StringBuilder();
            for (byte b : bytes) {
                hex.append(String.format("%02x", b));
            }
            token = hex.toString();
            server = new ServerSocket(0, 10, InetAddress.getByName("127.0.0.1"));
            writeInfo(server.getLocalPort());
            final ServerSocket listening = server;
            acceptor = new Thread(new Runnable() {
                @Override
                public void run() {
                    accept(listening);
                }
            }, "simrs-harness-bridge");
            acceptor.setDaemon(true);
            acceptor.start();
        } catch (Exception e) {
            System.out.println("SIMRS Harness bridge tidak aktif: " + e);
            stop();
        }
    }

    /** Stops listening (logout, exit) and removes the info file. */
    public static synchronized void stop() {
        try {
            if (server != null) {
                server.close();
            }
        } catch (IOException e) {
            // Already closed.
        }
        server = null;
        acceptor = null;
        token = null;
        infoFile().delete();
    }

    private static void writeInfo(int port) throws IOException {
        File file = infoFile();
        File dir = file.getParentFile();
        if (!dir.isDirectory() && !dir.mkdirs()) {
            throw new IOException("Tidak bisa membuat " + dir);
        }
        String content = "port=" + port + "\ntoken=" + token + "\nuser=" + akses.getkode() + "\n";
        try (OutputStream out = new FileOutputStream(file)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
        }
        // Owner only (macOS/Linux). On Windows the user profile folder is already private.
        try {
            Files.setPosixFilePermissions(file.toPath(), PosixFilePermissions.fromString("rw-------"));
        } catch (UnsupportedOperationException | IOException e) {
            // Not a POSIX file system.
        }
        file.deleteOnExit();
    }

    private static void accept(ServerSocket listening) {
        while (!listening.isClosed()) {
            try (Socket socket = listening.accept()) {
                socket.setSoTimeout(3000);
                String reply = handle(readLine(socket));
                Writer out = new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8);
                out.write(reply + "\n");
                out.flush();
            } catch (IOException e) {
                // Closed by stop(), or a client that went away.
            }
        }
    }

    private static String readLine(Socket socket) throws IOException {
        BufferedReader in = new BufferedReader(new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        StringBuilder line = new StringBuilder();
        int c;
        while ((c = in.read()) != -1 && c != '\n') {
            if (line.length() >= MAX_LINE) {
                return "";
            }
            line.append((char) c);
        }
        return line.toString().trim();
    }

    private static String handle(String line) {
        String[] parts = line.split("\t", -1);
        String expected;
        synchronized (HarnessBridge.class) {
            expected = token;
        }
        if (expected == null || parts.length < 2
                || !MessageDigest.isEqual(parts[0].getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8))) {
            return "ERR Token salah.";
        }
        if (parts[1].equals("ping")) {
            return "OK " + akses.getkode();
        }
        if (parts[1].equals("fill") && parts.length == 5) {
            return fill(parts[2], parts[3].trim(), parts[4]);
        }
        if (!parts[1].equals("open") || parts.length != 4) {
            return "ERR Perintah tidak dikenal.";
        }
        final String form = parts[2];
        final String value = parts[3].trim();
        // Checked on the Swing thread (Khanza's database helpers expect it), answered right away;
        // the form then opens like a menu click, including any warning Khanza itself shows.
        FutureTask<String> task = new FutureTask<String>(() -> {
            try {
                final String checked = check(form, value);
                SwingUtilities.invokeLater(new Runnable() {
                    @Override
                    public void run() {
                        open(form, checked);
                    }
                });
                return "OK";
            } catch (IllegalArgumentException e) {
                return "ERR " + e.getMessage();
            }
        });
        SwingUtilities.invokeLater(task);
        try {
            return task.get(10, TimeUnit.SECONDS);
        } catch (Exception e) {
            return "ERR Khanza sedang sibuk (ada jendela yang menunggu jawaban?), coba lagi.";
        }
    }

    /** Decodes "key=base64;..." into known resume fields. */
    private static java.util.Map<String, String> decodeFields(String payload) {
        java.util.Map<String, String> values = new java.util.LinkedHashMap<String, String>();
        if (payload.trim().isEmpty()) {
            return values;
        }
        for (String item : payload.split(";")) {
            int eq = item.indexOf('=');
            String key = eq > 0 ? item.substring(0, eq) : item;
            if (!RESUME_RANAP_FIELDS.containsKey(key)) {
                throw new IllegalArgumentException("Field " + key + " tidak ada di Resume Pasien Ranap.");
            }
            try {
                values.put(key, new String(java.util.Base64.getDecoder().decode(item.substring(eq + 1)), StandardCharsets.UTF_8));
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("Isi field " + key + " rusak.");
            }
        }
        return values;
    }

    private static String fill(final String form, final String noRawat, final String payload) {
        if (!form.equals("resume_ranap")) {
            return "ERR Form " + form + " belum bisa diisi dari SIMRS Harness.";
        }
        FutureTask<String> task = new FutureTask<String>(() -> {
            try {
                final java.util.Map<String, String> values = decodeFields(payload);
                final String checked = check("resume_ranap", noRawat);
                final boolean existing = !new sekuel().cariIsi(
                        "select resume_pasien_ranap.no_rawat from resume_pasien_ranap where resume_pasien_ranap.no_rawat=?", checked).equals("");
                SwingUtilities.invokeLater(new Runnable() {
                    @Override
                    public void run() {
                        fillResumeRanap(checked, values, existing);
                    }
                });
                return existing ? "OK ganti" : "OK baru";
            } catch (IllegalArgumentException e) {
                return "ERR " + e.getMessage();
            }
        });
        SwingUtilities.invokeLater(task);
        try {
            return task.get(10, TimeUnit.SECONDS);
        } catch (Exception e) {
            return "ERR Khanza sedang sibuk (ada jendela yang menunggu jawaban?), coba lagi.";
        }
    }

    /** Opens the resume form for the visit and puts the values into its fields; the user saves. */
    private static void fillResumeRanap(String noRawat, java.util.Map<String, String> values, boolean existing) {
        RMDataResumePasienRanap f = new RMDataResumePasienRanap(null, false);
        f.isCek();
        fit(f);
        f.setNoRm(noRawat, new Date());
        f.tampil();
        if (existing) {
            selectSaved(f, noRawat);
        }
        for (java.util.Map.Entry<String, String> entry : values.entrySet()) {
            setField(f, RESUME_RANAP_FIELDS.get(entry.getKey()), entry.getValue());
        }
        show(f);
    }

    /** Selects the saved resume in the form's table and loads it (what a click on the row does), so Ganti works. */
    private static void selectSaved(RMDataResumePasienRanap f, String noRawat) {
        try {
            java.lang.reflect.Field tableField = RMDataResumePasienRanap.class.getDeclaredField("tbObat");
            tableField.setAccessible(true);
            javax.swing.JTable table = (javax.swing.JTable) tableField.get(f);
            for (int row = 0; row < table.getRowCount(); row++) {
                if (noRawat.equals(String.valueOf(table.getValueAt(row, 0)))) {
                    table.setRowSelectionInterval(row, row);
                    java.lang.reflect.Method getData = RMDataResumePasienRanap.class.getDeclaredMethod("getData");
                    getData.setAccessible(true);
                    getData.invoke(f);
                    return;
                }
            }
        } catch (Exception e) {
            System.out.println("SIMRS Harness: resume tersimpan tidak bisa dipilih: " + e);
        }
    }

    /** Sets one field of a Khanza form by its variable name: text, choice (only a listed one) or date. */
    private static void setField(Object form, String name, String value) {
        try {
            java.lang.reflect.Field field = form.getClass().getDeclaredField(name);
            field.setAccessible(true);
            Object control = field.get(form);
            // The date picker is a combo box too, so it is checked first.
            if (control instanceof widget.Tanggal) {
                String pattern = value.length() > 10 ? "yyyy-MM-dd HH:mm" : "yyyy-MM-dd";
                ((widget.Tanggal) control).setDate(new SimpleDateFormat(pattern).parse(value.substring(0, Math.min(value.length(), 16))));
            } else if (control instanceof javax.swing.text.JTextComponent) {
                ((javax.swing.text.JTextComponent) control).setText(value);
            } else if (control instanceof javax.swing.JComboBox) {
                javax.swing.JComboBox<?> combo = (javax.swing.JComboBox<?>) control;
                for (int i = 0; i < combo.getItemCount(); i++) {
                    if (value.equals(String.valueOf(combo.getItemAt(i)))) {
                        combo.setSelectedIndex(i);
                    }
                }
            }
        } catch (Exception e) {
            System.out.println("SIMRS Harness: field " + name + " tidak bisa diisi: " + e);
        }
    }

    // --- Forms --------------------------------------------------------------------------------

    /** Permission and visit checks; returns the no. rawat (or no. RM for "riwayat"). Throws with a message for the user. */
    private static String check(String form, String value) {
        if (akses.getjml1() < 1 && akses.getjml2() < 1) {
            throw new IllegalArgumentException("Belum login di Khanza.");
        }
        sekuel sequel = new sekuel();
        switch (form) {
            case "resume":
            case "soap":
                return pickByVisit(sequel, form, value);
            case "resume_ranap":
            case "resume_ralan":
                allowed(akses.getdata_resume_pasien(), "Resume Pasien");
                return visit(sequel, value);
            case "soap_ralan":
                allowed(akses.gettindakan_ralan(), "Tindakan Ralan");
                return visit(sequel, value);
            case "soap_ranap":
                allowed(akses.gettindakan_ranap(), "Tindakan Ranap");
                return visit(sequel, value);
            case "riwayat": {
                String noRm = NO_RAWAT.matcher(value).matches()
                        ? sequel.cariIsi("select reg_periksa.no_rkm_medis from reg_periksa where reg_periksa.no_rawat=?", value)
                        : value;
                if (!NO_RM.matcher(noRm).matches()
                        || sequel.cariIsi("select pasien.no_rkm_medis from pasien where pasien.no_rkm_medis=?", noRm).equals("")) {
                    throw new IllegalArgumentException("Pasien " + value + " tidak ditemukan.");
                }
                return noRm;
            }
            default:
                throw new IllegalArgumentException("Form " + form + " belum didukung.");
        }
    }

    /** "resume" / "soap": the ranap or ralan form, from the visit's status. Returns "form\tno_rawat". */
    private static String pickByVisit(sekuel sequel, String form, String value) {
        String noRawat = visit(sequel, value);
        boolean ranap = sequel.cariIsi("select reg_periksa.status_lanjut from reg_periksa where reg_periksa.no_rawat=?", noRawat).equals("Ranap");
        String picked = form + (ranap ? "_ranap" : "_ralan");
        check(picked, noRawat);
        return picked + "\t" + noRawat;
    }

    /** Opens a checked form the way Khanza's own patient lists do. */
    private static void open(String form, String value) {
        if (value.contains("\t")) {
            String[] picked = value.split("\t", 2);
            open(picked[0], picked[1]);
            return;
        }
        sekuel sequel = new sekuel();
        switch (form) {
            case "resume_ranap": {
                RMDataResumePasienRanap f = new RMDataResumePasienRanap(null, false);
                f.isCek();
                fit(f);
                f.setNoRm(value, new Date());
                f.tampil();
                show(f);
                break;
            }
            case "resume_ralan": {
                RMDataResumePasien f = new RMDataResumePasien(null, false);
                f.isCek();
                fit(f);
                f.setNoRm(value, new Date());
                f.tampil();
                show(f);
                break;
            }
            case "soap_ralan": {
                DlgRawatJalan f = new DlgRawatJalan(null, false);
                f.isCek();
                fit(f);
                f.SetPoli(sequel.cariIsi("select reg_periksa.kd_poli from reg_periksa where reg_periksa.no_rawat=?", value));
                f.SetPj(sequel.cariIsi("select reg_periksa.kd_pj from reg_periksa where reg_periksa.no_rawat=?", value));
                f.setNoRm(value, registered(sequel, value), new Date());
                show(f);
                break;
            }
            case "soap_ranap": {
                setDepo(sequel, value);
                DlgRawatInap f = new DlgRawatInap(null, false);
                f.isCek();
                fit(f);
                f.setNoRm(value, registered(sequel, value), new Date());
                show(f);
                break;
            }
            case "riwayat": {
                RMRiwayatPerawatan f = new RMRiwayatPerawatan(null, false);
                f.setNoRm(value, sequel.cariIsi("select pasien.nm_pasien from pasien where pasien.no_rkm_medis=?", value));
                fit(f);
                show(f);
                break;
            }
            default:
                break;
        }
    }

    private static void allowed(boolean right, String menu) {
        if (!right) {
            throw new IllegalArgumentException("User ini tidak punya hak akses " + menu + " di Khanza.");
        }
    }

    /** A no. rawat that exists. */
    private static String visit(sekuel sequel, String value) {
        if (!NO_RAWAT.matcher(value).matches()) {
            throw new IllegalArgumentException("No. rawat tidak valid: " + value);
        }
        if (sequel.cariIsi("select reg_periksa.no_rawat from reg_periksa where reg_periksa.no_rawat=?", value).equals("")) {
            throw new IllegalArgumentException("No. rawat " + value + " tidak ditemukan.");
        }
        return value;
    }

    /** Registration date of the visit (start of the date range the form shows). */
    private static Date registered(sekuel sequel, String noRawat) {
        try {
            String tgl = sequel.cariIsi("select reg_periksa.tgl_registrasi from reg_periksa where reg_periksa.no_rawat=?", noRawat);
            return new SimpleDateFormat("yyyy-MM-dd").parse(tgl);
        } catch (Exception e) {
            return new Date();
        }
    }

    /** Stock location for the inpatient form, chosen the way DlgKamarInap does. */
    private static void setDepo(sekuel sequel, String noRawat) {
        String kamar = sequel.cariIsi("select kamar_inap.kd_kamar from kamar_inap where kamar_inap.no_rawat=? order by kamar_inap.tgl_masuk desc, kamar_inap.jam_masuk desc limit 1", noRawat);
        String bangsal = sequel.cariIsi("select kamar.kd_bangsal from kamar where kamar.kd_kamar=?", kamar);
        String depo = sequel.cariIsi("select set_depo_ranap.kd_depo from set_depo_ranap where set_depo_ranap.kd_bangsal=?", bangsal);
        if (!depo.equals("")) {
            akses.setkdbangsal(depo);
        } else if (sequel.cariIsi("select set_lokasi.asal_stok from set_lokasi").equals("Gunakan Stok Bangsal")) {
            akses.setkdbangsal(bangsal);
        } else {
            akses.setkdbangsal(sequel.cariIsi("select set_lokasi.kd_bangsal from set_lokasi"));
        }
    }

    private static void fit(Window w) {
        Dimension screen = Toolkit.getDefaultToolkit().getScreenSize();
        w.setSize(screen.width - 80, screen.height - 120);
        w.setLocationRelativeTo(null);
    }

    private static void show(Window w) {
        w.setVisible(true);
        w.toFront();
        w.requestFocus();
    }
}
